"""Router-only Windows Credential Manager enrollment; never prints a secret.
No router requests, personal-browser access, credential enumeration or schedules.
CredRead/Write documentation: learn.microsoft.com/windows/win32/api/wincred/
"""
from __future__ import annotations
import ctypes as C
from ctypes import wintypes as W
import hashlib, hmac, json, os, secrets, subprocess, sys
from pathlib import Path
TARGET = 'Aurum:Router:TPLink-AXE75v1:administrator'
TEST_TARGET = TARGET + ':storage-selftest'
ALLOWED = {TARGET, TEST_TARGET}
class CredentialError(Exception):
    pass
class Credential(C.Structure):
    _fields_ = [('Flags', W.DWORD), ('Type', W.DWORD),
        ('TargetName', W.LPWSTR), ('Comment', W.LPWSTR),
        ('LastWritten', W.FILETIME), ('CredentialBlobSize', W.DWORD),
        ('CredentialBlob', C.POINTER(W.BYTE)), ('Persist', W.DWORD),
        ('AttributeCount', W.DWORD), ('Attributes', C.c_void_p),
        ('TargetAlias', W.LPWSTR), ('UserName', W.LPWSTR)]
PCRED = C.POINTER(Credential)
API = C.WinDLL('Advapi32.dll', use_last_error=True)
API.CredReadW.argtypes = [W.LPCWSTR, W.DWORD, W.DWORD, C.POINTER(PCRED)]
API.CredReadW.restype = W.BOOL
API.CredWriteW.argtypes = [PCRED, W.DWORD]
API.CredWriteW.restype = W.BOOL
API.CredFree.argtypes = [C.c_void_p]
API.CredFree.restype = None
API.CredDeleteW.argtypes = [W.LPCWSTR, W.DWORD, W.DWORD]
API.CredDeleteW.restype = W.BOOL

def checked_target(target: str) -> str:
    if target not in ALLOWED:
        raise CredentialError('target_not_allowed')
    return target

def _fetch(target: str) -> PCRED | None:
    ptr = PCRED()
    if not API.CredReadW(checked_target(target), 1, 0, C.byref(ptr)):
        code = C.get_last_error()
        if code == 1168:
            return None
        raise CredentialError('credential_read_failed_' + str(code))
    return ptr

def metadata(target: str = TARGET) -> dict:
    ptr = _fetch(target)
    if ptr is None:
        return {'present': False, 'target': target}
    try:
        return {'present': True, 'target': target, 'persist': ptr.contents.Persist,
                'storage': 'Windows Credential Manager', 'router_login_verified': False}
    finally:
        API.CredFree(ptr)

def _read_secret(target: str = TARGET) -> str:
    """Internal connector use only. Never log, return via tool, or export this value."""
    ptr = _fetch(target)
    if ptr is None:
        raise CredentialError('credential_not_enrolled')
    try:
        item = ptr.contents
        if item.Persist != 2 or not 0 < item.CredentialBlobSize <= 2560:
            raise CredentialError('credential_shape_invalid')
        return C.string_at(item.CredentialBlob, item.CredentialBlobSize).decode('utf-16-le')
    finally:
        API.CredFree(ptr)

def validate_secret(secret: str) -> bytes:
    if not isinstance(secret, str) or not secret or '\x00' in secret:
        raise CredentialError('nonempty_password_required')
    data = secret.encode('utf-16-le')
    if len(data) > 2560:
        raise CredentialError('password_too_long')
    return data

def write_new(secret: str, target: str = TARGET) -> None:
    data = validate_secret(secret)
    if metadata(checked_target(target))['present']:
        raise CredentialError('existing_credential_preserved')
    buf = (W.BYTE * len(data)).from_buffer_copy(data)
    item = Credential(Type=1, TargetName=target, Comment='Authorized router-only local connector',
        CredentialBlobSize=len(data), CredentialBlob=buf, Persist=2, UserName='router-administrator')
    try:
        if not API.CredWriteW(C.byref(item), 0):
            raise CredentialError('credential_write_failed_' + str(C.get_last_error()))
    finally:
        C.memset(buf, 0, len(data))

def verify_in_new_process(secret: str, target: str) -> bool:
    nonce = secrets.token_hex(32)
    tag = hmac.new(nonce.encode(), secret.encode('utf-16-le'), hashlib.sha256).hexdigest()
    process = subprocess.run([sys.executable, str(Path(__file__).resolve()), '_verify',
        checked_target(target)], input=json.dumps({'nonce': nonce, 'tag': tag}),
        capture_output=True, text=True, timeout=12, creationflags=0x08000000)
    # Neither the challenge nor its tag are logged or written to disk.
    if process.returncode != 0:
        return False
    try:
        return json.loads(process.stdout) == {'matched': True, 'persist': 2}
    except (ValueError, TypeError):
        return False

def check_challenge(target: str) -> dict:
    challenge = json.loads(sys.stdin.read(2048))
    nonce, tag = challenge['nonce'], challenge['tag']
    if any(not isinstance(v, str) or len(v) != 64 for v in (nonce, tag)):
        raise CredentialError('invalid_challenge')
    actual = hmac.new(nonce.encode(), _read_secret(target).encode('utf-16-le'), hashlib.sha256).hexdigest()
    return {'matched': hmac.compare_digest(actual, tag), 'persist': metadata(target)['persist']}

def delete_test_only() -> None:
    if not API.CredDeleteW(TEST_TARGET, 1, 0) and C.get_last_error() != 1168:
        raise CredentialError('test_cleanup_failed')

def self_test() -> dict:
    before = metadata()
    if metadata(TEST_TARGET)['present']:
        raise CredentialError('existing_test_entry_requires_review')
    value = 'SYNTHETIC-NOT-A-ROUTER-PASSWORD-' + secrets.token_hex(24) + '\u00e9'
    checks = {}
    try:
        write_new(value, TEST_TARGET)
        checks['persistent_storage'] = metadata(TEST_TARGET)['persist'] == 2
        checks['roundtrip'] = _read_secret(TEST_TARGET) == value
        checks['separate_process_readback'] = verify_in_new_process(value, TEST_TARGET)
        checks['wrong_value_rejected'] = not verify_in_new_process('wrong-synthetic', TEST_TARGET)
        try:
            write_new('do-not-overwrite', TEST_TARGET)
            checks['overwrite_prevented'] = False
        except CredentialError:
            checks['overwrite_prevented'] = _read_secret(TEST_TARGET) == value
        checks['empty_rejected'] = False
        try:
            validate_secret('')
        except CredentialError:
            checks['empty_rejected'] = True
    finally:
        delete_test_only()
    checks['test_entry_removed'] = not metadata(TEST_TARGET)['present']
    checks['primary_metadata_unchanged'] = metadata() == before
    return {'ok': all(checks.values()), 'checks': checks, 'router_password_used': False}

def enroll() -> None:
    import tkinter as tk
    from tkinter import messagebox, ttk
    kernel = C.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.argtypes = [C.c_void_p, W.BOOL, W.LPCWSTR]
    kernel.CreateMutexW.restype = W.HANDLE
    kernel.CloseHandle.argtypes = [W.HANDLE]
    handle = kernel.CreateMutexW(None, False, 'Local\\AurumRouterCredentialEnrollment')
    if not handle:
        raise CredentialError('enrollment_lock_failed')
    if C.get_last_error() == 183:
        kernel.CloseHandle(handle)
        raise CredentialError('enrollment_window_already_open')
    window = tk.Tk()
    window.title('Router access - secure local setup')
    window.geometry('610x410')
    window.resizable(False, False)
    frame = ttk.Frame(window, padding=22)
    frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='Save router access on this laptop', font=('Segoe UI', 14, 'bold')).pack(anchor='w')
    ttk.Label(frame, text='TP-Link Archer AXE75 v1 | Router administrator password\nNot your Wi-Fi password. Nothing is sent to ChatGPT.', wraplength=560).pack(anchor='w', pady=(10,12))
    ttk.Label(frame, text='Router administrator password').pack(anchor='w')
    password = ttk.Entry(frame, show='*', width=58)
    password.pack(anchor='w', pady=(3,9))
    ttk.Label(frame, text='Confirm password').pack(anchor='w')
    confirmation = ttk.Entry(frame, show='*', width=58)
    confirmation.pack(anchor='w', pady=(3,10))
    consent = tk.BooleanVar(value=False)
    ttk.Checkbutton(frame, text='Allow this local router connector to retain and reuse this password.', variable=consent).pack(anchor='w')
    ttk.Label(frame, text='Windows Credential Manager, same Windows account on this computer.\nOther programs running as you may access it. Router settings will not change.', wraplength=565).pack(anchor='w', pady=(8,9))
    state = tk.StringVar(value='Enter once here. Future router login testing is a separate step.')
    ttk.Label(frame, textvariable=state, wraplength=565).pack(anchor='w')
    receipt = Path.home() / '.aurum' / 'router-access' / 'enrollment-status.json'
    def record(status, saved=False, verified=False):
        receipt.parent.mkdir(parents=True, exist_ok=True)
        data = {'schema':'aurum.router.enrollment.v1','operation_id':'aurum-router-adapter-v1',
                'pid':os.getpid(),'ui_title':window.title(),'state':status,
                'credential_saved':saved,'separate_process_readback':verified,
                'router_login_verified':False,'offsite_access_verified':False}
        temp = receipt.with_suffix('.tmp')
        temp.write_text(json.dumps(data, indent=2), encoding='utf-8')
        temp.replace(receipt)
    def save():
        saved = False
        value, other = password.get(), confirmation.get()
        if not consent.get():
            state.set('Please check the permission box before saving.'); return
        if value != other:
            state.set('The two entries do not match.'); return
        try:
            validate_secret(value)
            write_new(value)
            saved = True
            if not verify_in_new_process(value, TARGET):
                raise CredentialError('saved_but_readback_requires_review')
            password.delete(0, 'end'); confirmation.delete(0, 'end')
            record('credential_saved', True, True)
            state.set('Saved securely. Separate-process retrieval passed. Router login is not yet tested.')
            button.configure(state='disabled')
            messagebox.showinfo('Router credential saved', 'Saved in Windows Credential Manager.\nA separate process verified retrieval.\nThe connector can now reuse it without this window.\nRouter login and off-site access still need testing.', parent=window)
        except Exception as error:
            code = str(error) if isinstance(error, CredentialError) else type(error).__name__
            state.set('Setup needs review: ' + code)
            record('review_required', saved, False)
        finally:
            password.delete(0, 'end'); confirmation.delete(0, 'end')
            value = other = None
    buttons = ttk.Frame(frame)
    buttons.pack(anchor='e', pady=(12,0))
    button = ttk.Button(buttons, text='Save securely', command=save)
    button.pack(side='left', padx=6)
    ttk.Button(buttons, text='Close', command=window.destroy).pack(side='left')
    try:
        if metadata()['present']:
            button.configure(state='disabled')
            state.set('An existing router credential is preserved; this setup will not overwrite it.')
            record('existing_credential_preserved', True, False)
        else:
            window.after(250, lambda: record('awaiting_local_input'))
        window.lift(); window.attributes('-topmost', True)
        window.after(1500, lambda: window.attributes('-topmost', False))
        password.focus_set()
        window.mainloop()
    finally:
        kernel.CloseHandle(handle)

def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else 'status'
    try:
        if action == 'status':
            result = metadata()
        elif action == 'self-test':
            result = self_test()
        elif action == '_verify' and len(sys.argv) == 3:
            result = check_challenge(checked_target(sys.argv[2]))
        elif action == 'enroll':
            enroll()
            return 0
        else:
            raise CredentialError('unsupported_action_no_secret_export')
        print(json.dumps(result))
        return 0 if result.get('ok', True) else 1
    except Exception as error:
        code = str(error) if isinstance(error, CredentialError) else type(error).__name__
        print(json.dumps({'ok':False,'error':code}))
        return 1

if __name__ == '__main__':
    raise SystemExit(main())

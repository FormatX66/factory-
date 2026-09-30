"""Bounded fixtures use the real pinned Future Branch and real Factory bridge."""
import concurrent.futures
import copy
import json
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest
from unittest import mock
from contextlib import closing
from pathlib import Path
import aurum

class EcosystemTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.receipts=self.root/'factory-receipts'
        self.job={'id':'acceptance-a','goal':'Check a synthetic integration contract',
                  'classification':'synthetic','requirements':['Return a proposal'],
                  'constraints':['No actual external action'],'needsTools':False,
                  'repo':'fixture','lkg':'fixture-baseline'}
        self.calls=0
        self.mode='ok'
        self.app=self.make_app()

    def submit(self,job):
        self.calls+=1
        p=subprocess.run(['node',str(Path(__file__).with_name('factory-fixture.mjs')),
                          str(self.receipts),self.mode],input=json.dumps(job),
                         capture_output=True,text=True,timeout=10,check=True)
        return json.loads(p.stdout)

    def read(self,ident):
        return json.loads((self.receipts/ident/'result.json').read_text(encoding='utf-8'))

    def make_app(self,**kw):
        return aurum.Ecosystem(self.root/'state',submit=kw.get('submit',self.submit),
            read_receipt=kw.get('read_receipt',self.read),adapter_identity='actual-factory-synthetic-fixture-v1',
            activation=kw.get('activation','fixture_only'))

    def run_job(self,job=None,app=None):
        j=job or self.job
        return (app or self.app).run(j,aurum.Grant(aurum.digest(aurum.normalize(j)),time.time()+60))

    def test_actual_factory_and_future_branch_delivery(self):
        r=self.run_job()
        self.assertEqual(r['status'],'proposal_verified')
        self.assertFalse(r['proof']['arbitrary_effect_verified'])
        self.assertEqual(self.calls,1)
        with closing(sqlite3.connect(self.root/'state'/'future-branch.sqlite3')) as c:
            self.assertEqual(c.execute("select state from future_operations").fetchone()[0],'observed')
            self.assertGreater(c.execute('select count(*) from future_operation_events').fetchone()[0],1)

    def test_live_activation_held_even_with_grant(self):
        r=self.run_job(app=self.make_app(activation='held'))
        self.assertEqual(r['reason'],'live_activation_held'); self.assertEqual(self.calls,0)

    def test_permission_missing(self):
        self.assertEqual(self.app.run(self.job,None)['reason'],'explicit_matching_authority_required')
        self.assertEqual(self.calls,0)

    def test_expired_grant(self):
        r=self.app.run(self.job,aurum.Grant(aurum.digest(self.job),time.time()-1))
        self.assertEqual(r['reason'],'explicit_matching_authority_required')

    def test_mismatched_grant(self):
        r=self.app.run(self.job,aurum.Grant('wrong',time.time()+60))
        self.assertEqual(r['reason'],'explicit_matching_authority_required')

    def test_private_job_not_sent(self):
        j={**self.job,'classification':'private'}
        self.assertEqual(self.run_job(j)['reason'],'unsupported_scope'); self.assertEqual(self.calls,0)

    def test_tools_not_sent(self):
        self.assertEqual(self.run_job({**self.job,'needsTools':True})['reason'],'unsupported_scope')
        self.assertEqual(self.calls,0)

    def test_embedded_authority_rejected(self):
        for key in ('command','authorized','recovery_observation','callback','endpoint','token'):
            with self.subTest(key=key),self.assertRaises(ValueError):
                self.run_job({**self.job,key:True})
        self.assertEqual(self.calls,0)

    def test_invalid_identifiers(self):
        for ident in ('../escape','..','x/y','x\\y','', 'x'*81):
            with self.subTest(ident=ident),self.assertRaises(ValueError):
                aurum.normalize({**self.job,'id':ident})

    def test_types_and_bounds(self):
        for change in ({'goal':[]},{'goal':'x'*4097},{'needsTools':'false'},
                       {'classification':'secret'},{'requirements':['x'*513]},
                       {'constraints':'not-list'},{'lkg':''}):
            with self.subTest(change=list(change)),self.assertRaises(ValueError):
                aurum.normalize({**self.job,**change})

    def test_completed_proposal_reused_with_receipt_readback(self):
        self.run_job(); r=self.run_job(app=self.make_app())
        self.assertTrue(r['cached']); self.assertFalse(r['submitted']); self.assertEqual(self.calls,1)

    def test_changed_input_same_id_held(self):
        self.run_job()
        self.assertEqual(self.run_job({**self.job,'goal':'Different goal'})['reason'],'operation_id_conflict')
        self.assertEqual(self.calls,1)

    def test_cached_receipt_tampering_held(self):
        self.run_job(); p=self.receipts/self.job['id']/'result.json'
        v=json.loads(p.read_text()); v['output']='tampered'; p.write_text(json.dumps(v))
        self.assertEqual(self.run_job()['reason'],'cached_receipt_unverified'); self.assertEqual(self.calls,1)

    def test_missing_receipt_uncertain_no_replay(self):
        app=self.make_app(read_receipt=lambda _: (_ for _ in ()).throw(FileNotFoundError()))
        self.assertEqual(self.run_job(app=app)['reason'],'outcome_uncertain')
        self.assertEqual(self.run_job(app=self.make_app())['reason'],'prior_attempt_requires_review')
        self.assertEqual(self.calls,1)

    def test_failed_semantics_block_new_operation_id(self):
        self.mode='worker-error'; self.assertEqual(self.run_job()['reason'],'outcome_uncertain')
        self.mode='ok'
        r=self.run_job({**self.job,'id':'acceptance-new-id'},app=self.make_app())
        self.assertEqual(r['reason'],'unchanged_failed_operation'); self.assertEqual(self.calls,1)

    def test_mismatched_response_held(self):
        self.mode='bad-id'; self.assertEqual(self.run_job()['reason'],'outcome_uncertain')

    def test_unrelated_operation_continues_after_failure(self):
        self.mode='worker-error'; self.run_job(); self.mode='ok'
        r=self.run_job({**self.job,'id':'independent-lane','goal':'A different synthetic operation'})
        self.assertEqual(r['status'],'proposal_verified'); self.assertEqual(self.calls,2)

    def test_concurrent_duplicate_submits_once(self):
        entered=threading.Event(); release=threading.Event()
        def slow(j):
            entered.set(); release.wait(3); return self.submit(j)
        app=self.make_app(submit=slow)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first=pool.submit(self.run_job,None,app)
            self.assertTrue(entered.wait(3))
            second=self.run_job(app=self.make_app())
            self.assertEqual(second['status'],'held'); release.set()
            self.assertEqual(first.result(5)['status'],'proposal_verified')
        self.assertEqual(self.calls,1)

    def test_contract_tampering_rejected(self):
        self.run_job(); receipt=self.read(self.job['id'])
        for key in ('goal','lkg','repo','requirements','constraints'):
            r=copy.deepcopy(receipt); r['task'][key]='wrong'
            with self.subTest(key=key),self.assertRaises(aurum.ReceiptMismatch):
                aurum.verify_factory_receipt(self.job,{**receipt,'ok':True},r)

    def test_no_raw_goal_in_coordination_databases(self):
        self.run_job()
        for p in (self.root/'state').glob('*.sqlite3'):
            self.assertNotIn(self.job['goal'].encode(),p.read_bytes())


    def test_nonfinite_expiry_rejected(self):
        for expiry in (float('nan'),float('inf'),float('-inf')):
            with self.subTest(expiry=repr(expiry)):
                r=self.app.run(self.job,aurum.Grant(aurum.digest(self.job),expiry))
                self.assertEqual(r['reason'],'explicit_matching_authority_required')
        self.assertEqual(self.calls,0)

    def test_unqualified_route_rejected(self):
        self.run_job(); receipt=self.read(self.job['id'])
        receipt['route']='unqualified/worker'; receipt['task']['worker']=receipt['route']
        with self.assertRaises(aurum.ReceiptMismatch):
            aurum.verify_factory_receipt(self.job,{**receipt,'ok':True},receipt)

    def probe_fixture(self,name,code,body):
        connection=mock.Mock()
        response=connection.getresponse.return_value
        response.status=code; response.read.return_value=json.dumps(body).encode()
        with mock.patch.object(aurum.http.client,'HTTPConnection',return_value=connection):
            result=aurum.probe_component(name,19470,'fixture')
        connection.request.assert_called_once_with('GET','/health')
        connection.close.assert_called_once()
        return result

    def test_malformed_explorer_health_stays_unverified(self):
        r=self.probe_fixture('future_branch',200,{'status':'healthy','event_chain_valid':True,'continuous_exploration':[]})
        self.assertEqual(r['state'],'unverified')

    def test_authentication_required_is_not_offline(self):
        r=self.probe_fixture('medic_factory',401,{'error':'unauthorized'})
        self.assertEqual(r['state'],'authentication_required'); self.assertFalse(r['execution_verified'])

    def test_wrong_service_identity_is_unverified(self):
        r=self.probe_fixture('commander',200,{'ok':True,'service':'another-service'})
        self.assertEqual(r['state'],'unverified')

    def test_redirect_is_not_followed(self):
        r=self.probe_fixture('commander',302,{'location':'https://untrusted.invalid'})
        self.assertEqual(r['state'],'unverified')

    def test_health_exception_is_bounded(self):
        with mock.patch.object(aurum.http.client,'HTTPConnection') as ctor:
            ctor.return_value.request.side_effect=TimeoutError()
            r=aurum.probe_component('commander',19470,'fixture')
            self.assertEqual(r['state'],'unreachable_or_invalid')
            ctor.return_value.close.assert_called_once()

    def test_cli_has_no_live_submit_action(self):
        p=subprocess.run(['python',str(Path(aurum.__file__)),'submit'],capture_output=True,text=True,timeout=5)
        self.assertNotEqual(p.returncode,0)
        self.assertEqual(self.calls,0)

if __name__=='__main__':
    unittest.main(verbosity=2)

import unittest
from connectivity import *
class T(unittest.TestCase):
    def test_normal_wins(self): self.assertEqual(decide(Observation(True,True,True,True,False,True)).action,"keep_normal")
    def test_saved_profile_before_recovery(self): self.assertEqual(decide(Observation(True,True,False,True,False,True)).action,"try_saved_profile_once")
    def test_driver_failure_holds(self): self.assertEqual(decide(Observation(False,True,False,True,False,True)).reason,"radio_or_driver_unavailable")
    def test_recovery_requires_pairing(self): self.assertEqual(decide(Observation(True,False,False,True,False,False)).mode,Mode.HOLD)
    def test_recovery_starts(self): self.assertEqual(decide(Observation(True,False,False,True,False,True)).action,"start_private_recovery")
    def test_no_universal_secret(self):
        self.assertTrue(secret_policy(False,True)); self.assertFalse(secret_policy(True,True)); self.assertFalse(secret_policy(False,False))
if __name__=="__main__": unittest.main()

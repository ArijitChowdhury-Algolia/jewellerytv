import unittest
from scorer import score, cents

def events(price=10.01, ident='a'):
    return [{'type':'tool-output-available','output':{'hits':[{'objectID':'a','Pricing_ActivePrice':price},{'objectID':'b','Pricing_ActivePrice':0.2}]}}, {'type':'tool-input-available','toolName':'algolia_grouped_results','input':{'groups':[{'results':[{'objectID':ident}]}]}}]
class EvidenceChecks(unittest.TestCase):
    def test_cents(self): self.assertEqual(cents('0.29'),29)
    def test_invalid_prices(self):
        for value in (None,True,'NaN',-1,'1.001'):
            with self.assertRaises(ValueError): cents(value)
    def test_unobserved_is_not_pass(self): self.assertEqual(score([])['findings'][1]['status'],'not_observed')
    def test_invented_id_fails(self): self.assertEqual(score(events(ident='invented'))['findings'][1]['status'],'fail')
    def test_strict_budget(self): self.assertEqual(score(events(150),checks={'each_below_cents':15000})['findings'][2]['status'],'fail')
    def test_missing_price(self): self.assertEqual(score(events(None),checks={'each_below_cents':15000})['findings'][2]['status'],'not_observed')
    def test_explicit_pair_arithmetic(self):
        result=score(events(0.1),checks={'pair_ids':['a','b'],'combined_limit_cents':30})
        self.assertEqual(result['findings'][2]['detail']['total_cents'],30)
        self.assertEqual(result['findings'][2]['status'],'pass')
    def test_never_sum_alternative_groups(self): self.assertEqual(len(score(events())['findings']),2)
    def test_block_event_fails(self): self.assertEqual(score([{'type':'data-guardrail-violation'}])['findings'][0]['status'],'fail')
    def test_historical_evidence_supported(self):
        request={'messages':[{'parts':[{'output':{'hits':[{'objectID':'a','Pricing_ActivePrice':10}]}}]}]}
        self.assertEqual(score(events()[1:],request)['findings'][1]['status'],'pass')
class ConfigurationChecks(unittest.TestCase):
    def test_usage_timestamp_does_not_invalidate_run(self):
        from run import configuration_hash
        self.assertEqual(configuration_hash({'model':'x','lastUsedAt':'a'}),configuration_hash({'model':'x','lastUsedAt':'b'}))
        self.assertNotEqual(configuration_hash({'model':'x'}),configuration_hash({'model':'y'}))

if __name__=='__main__': unittest.main()

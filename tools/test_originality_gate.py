import copy
import unittest
from originality_gate import evaluate


class OriginalityEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.current = {
            'rendererId': 'new', 'backgroundGrammar': 'original',
            'cameraModel': 'action-follow', 'primaryInteraction': 'execute-test',
            'durationSeconds': 50, 'proofSeconds': 40, 'textCardSeconds': 2,
            'palette': ['#123456', '#234567', '#345678'],
            'sceneSignatures': ['a', 'b', 'c', 'd', 'e', 'f'],
            'rights': {key: True for key in (
                'commercialUseCleared', 'originalOrProceduralVisuals', 'voiceLicenseCleared')},
        }
        self.history = [dict(self.current, rendererId='old', backgroundGrammar='old',
                             sceneSignatures=['g', 'h', 'i', 'j', 'k', 'l'])]

    def test_valid_evidence(self):
        self.assertTrue(evaluate(self.current, self.history)['passed'])

    def test_empty_history_is_not_a_pass(self):
        self.assertFalse(evaluate(self.current, [])['passed'])

    def test_missing_or_invalid_durations(self):
        for key in ('proofSeconds', 'textCardSeconds'):
            for value in (None, -1, 100, float('nan'), float('inf'), True):
                with self.subTest(key=key, value=value):
                    current = copy.deepcopy(self.current)
                    current[key] = value
                    self.assertFalse(evaluate(current, self.history)['passed'])

    def test_reused_renderer_blocked(self):
        self.current['rendererId'] = 'old'
        self.assertFalse(evaluate(self.current, self.history)['passed'])

    def test_low_proof_blocked(self):
        self.current['proofSeconds'] = 10
        self.assertFalse(evaluate(self.current, self.history)['passed'])

    def test_invalid_total_duration(self):
        for value in ('unknown', float('nan'), 0):
            self.current['durationSeconds'] = value
            self.assertFalse(evaluate(self.current, self.history)['passed'])


if __name__ == '__main__':
    unittest.main()

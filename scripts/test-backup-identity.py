import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('identity', Path(__file__).with_name('configure-backup-identity.py'))
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)


class IdentityTests(unittest.TestCase):
    def run_mode(self, mode, *, missing=False, wrong_role=False, fresh=True, runtime=True):
        calls = []
        policy = {'version': 3, 'etag': 'keep-etag', 'bindings': [
            {'role': identity.ROLE, 'members': ['serviceAccount:' + identity.ACCOUNT]},
            {'role': 'roles/datastore.importExportAdmin', 'members': ['serviceAccount:' + identity.DEFAULT, 'serviceAccount:unrelated@example.invalid']},
            {'role': 'roles/viewer', 'members': ['user:owner@example.invalid'], 'condition': {'title': 'keep', 'expression': 'true'}},
        ]}

        def urlopen(req, **kwargs):
            body = json.loads(req.data) if req.data else None
            calls.append((req.full_url, req.method, body))
            url = req.full_url
            if url == identity.SA and req.method == 'GET':
                if missing:
                    raise urllib.error.HTTPError(url, 404, 'not found', {}, None)
                result = {'email': identity.ACCOUNT}
            elif url == identity.IAM + identity.ROLE:
                if missing:
                    raise urllib.error.HTTPError(url, 404, 'not found', {}, None)
                result = {'includedPermissions': identity.PERMISSIONS + (['datastore.databases.import'] if wrong_role else [])}
            elif url.endswith('/serviceAccounts'):
                result = {'email': identity.ACCOUNT}
            elif url.endswith('/roles'):
                result = body['role']
            elif 'getIamPolicy' in url:
                result = {'etag': 'sa-etag', 'bindings': []} if '/serviceAccounts/' in url else copy.deepcopy(policy)
            elif url.endswith(':testIamPermissions'):
                result = {'permissions': ['iam.serviceAccounts.actAs']}
            elif url.endswith(':setIamPolicy'):
                result = body['policy']
            elif 'cloudfunctions.googleapis.com' in url:
                result = {'state': 'ACTIVE', 'serviceConfig': {'serviceAccountEmail': identity.ACCOUNT if runtime else identity.DEFAULT}, 'updateTime': '2026-09-29T12:00:00Z'}
            elif '/documents/backupRuns/' in url:
                result = {'fields': {'status': {'stringValue': 'completed'}, 'serviceAccount': {'stringValue': identity.ACCOUNT}, 'completedAt': {'timestampValue': '2026-09-29T13:00:00Z' if fresh else '2026-09-29T11:00:00Z'}, 'outputUriPrefix': {'stringValue': 'gs://blastybiz-firestore-backups/new'}}}
            else:
                raise AssertionError('Unexpected request ' + url)
            return contextlib.closing(io.BytesIO(json.dumps(result).encode()))

        self.calls = calls
        with patch('sys.argv', ['identity', mode]), patch.object(identity.subprocess, 'check_output', return_value='fixture-token'), patch.object(identity.urllib.request, 'urlopen', side_effect=urlopen), contextlib.redirect_stdout(io.StringIO()) as output:
            identity.main()
        return calls, output.getvalue(), policy

    def test_check_does_not_mutate(self):
        calls, output, _ = self.run_mode('--check')
        self.assertTrue(json.loads(output)['ready'])
        self.assertFalse(any('setIamPolicy' in url or url.endswith('/roles') or url.endswith('/serviceAccounts') for url, _, _ in calls))

    def test_missing_identity_blocks_check(self):
        with self.assertRaises(SystemExit) as caught:
            self.run_mode('--check', missing=True)
        self.assertEqual(caught.exception.code, 2)

    def test_broad_existing_role_is_rejected(self):
        with self.assertRaises(RuntimeError):
            self.run_mode('--setup', wrong_role=True)
        self.assertFalse(any('setIamPolicy' in url for url, _, _ in self.calls))

    def test_setup_grants_only_dedicated_account_and_scoped_act_as(self):
        calls, _, _ = self.run_mode('--setup', missing=True)
        role = next(body['role'] for url, _, body in calls if url.endswith('/roles'))
        self.assertNotIn('datastore.databases.import', role['includedPermissions'])
        self.assertNotIn('datastore.entities.delete', role['includedPermissions'])
        self.assertIn('datastore.entities.create', role['includedPermissions'])
        sa = next(body['policy'] for url, _, body in calls if '/serviceAccounts/' in url and url.endswith(':setIamPolicy'))
        self.assertEqual(sa['etag'], 'sa-etag')
        self.assertEqual(sa['bindings'], [{'role': 'roles/iam.serviceAccountUser', 'members': ['serviceAccount:' + identity.ENGINE]}])
        self.assertFalse(any('cloudfunctions.googleapis.com' in url for url, _, _ in calls))

    def test_wrong_runtime_prevents_removal(self):
        with self.assertRaises(RuntimeError):
            self.run_mode('--remove-shared-role', runtime=False)
        self.assertFalse(any('setIamPolicy' in url for url, _, _ in self.calls))

    def test_old_export_prevents_removal(self):
        with self.assertRaises(RuntimeError):
            self.run_mode('--remove-shared-role', fresh=False)
        self.assertFalse(any('setIamPolicy' in url for url, _, _ in self.calls))

    def test_verified_removal_preserves_other_members_conditions_and_etag(self):
        calls, _, before = self.run_mode('--remove-shared-role')
        after = next(body['policy'] for url, _, body in calls if url.endswith(':setIamPolicy'))
        self.assertEqual(after['etag'], before['etag'])
        self.assertEqual(after['bindings'][2], before['bindings'][2])
        self.assertEqual(after['bindings'][1]['members'], ['serviceAccount:unrelated@example.invalid'])


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Owner-run IAM setup; --check is read-only and is used by Main deployment."""
import argparse
import datetime
import json
import subprocess
import urllib.error
import urllib.request

PROJECT = 'blastybiz-9523e'
ACCOUNT = f'firestore-backup@{PROJECT}.iam.gserviceaccount.com'
ENGINE = 'github-action-1249917275@flubadesigns-25482.iam.gserviceaccount.com'
DEFAULT = '745597683278-compute@developer.gserviceaccount.com'
ROLE = f'projects/{PROJECT}/roles/blastybizBackupExporter'
PERMISSIONS = sorted(['datastore.databases.export', 'datastore.databases.getMetadata',
                      'datastore.operations.get', 'datastore.entities.get',
                      'datastore.entities.create', 'datastore.entities.update'])
IAM = 'https://iam.googleapis.com/v1/'
RESOURCE = f'https://cloudresourcemanager.googleapis.com/v1/projects/{PROJECT}'
SA = IAM + f'projects/{PROJECT}/serviceAccounts/{ACCOUNT}'


def grant(policy, role, member):
    bindings = policy.setdefault('bindings', [])
    binding = next((b for b in bindings if b['role'] == role and not b.get('condition')), None)
    if binding is None:
        binding = {'role': role, 'members': []}
        bindings.append(binding)
    if member in binding['members']:
        return False
    binding['members'].append(member)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--setup', action='store_true')
    mode.add_argument('--remove-shared-role', action='store_true')
    args = parser.parse_args()
    token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()

    def request(url, method='GET', body=None, missing=False):
        req = urllib.request.Request(url, method=method,
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            if missing and exc.code == 404:
                return None
            raise RuntimeError(f'{method} {url.split("?")[0]} HTTP {exc.code}') from None

    account = request(SA, missing=True)
    role = request(IAM + ROLE, missing=True)
    policy = request(RESOURCE + ':getIamPolicy', 'POST', {'options': {'requestedPolicyVersion': 3}})
    if args.setup:
        if account is None:
            account = request(IAM + f'projects/{PROJECT}/serviceAccounts', 'POST',
                              {'accountId': 'firestore-backup', 'serviceAccount': {'displayName': 'BlastyBiz backup export only'}})
        if account.get('disabled'):
            raise RuntimeError('Dedicated account is disabled; review required')
        if role is None:
            role = request(IAM + f'projects/{PROJECT}/roles', 'POST',
                           {'roleId': 'blastybizBackupExporter', 'role': {'title': 'BlastyBiz Backup Exporter', 'stage': 'GA', 'includedPermissions': PERMISSIONS}})
        if role.get('deleted') or sorted(role.get('includedPermissions', [])) != PERMISSIONS:
            raise RuntimeError('Existing custom role differs from reviewed permissions; no grant made')
        if grant(policy, ROLE, 'serviceAccount:' + ACCOUNT):
            request(RESOURCE + ':setIamPolicy', 'POST', {'policy': policy})
        sa_policy = request(SA + ':getIamPolicy?options.requestedPolicyVersion=3', 'POST')
        if grant(sa_policy, 'roles/iam.serviceAccountUser', 'serviceAccount:' + ENGINE):
            request(SA + ':setIamPolicy', 'POST', {'policy': sa_policy})
        print('Dedicated backup identity prepared. Return to the agent for deployment and fresh-export verification.')
        return

    member = 'serviceAccount:' + ACCOUNT
    ready = bool(account and not account.get('disabled') and role and not role.get('deleted')
                 and sorted(role.get('includedPermissions', [])) == PERMISSIONS
                 and any(b['role'] == ROLE and member in b.get('members', []) and not b.get('condition') for b in policy.get('bindings', [])))
    if args.check:
        can_act = False
        if account:
            access = request(SA + ':testIamPermissions', 'POST', {'permissions': ['iam.serviceAccounts.actAs']})
            can_act = 'iam.serviceAccounts.actAs' in access.get('permissions', [])
        report = {'project': PROJECT, 'serviceAccount': ACCOUNT, 'role': ROLE,
                  'accountExists': bool(account), 'roleReady': ready, 'deployerCanActAs': can_act,
                  'ready': ready and can_act,
                  'sharedImportExportRolePresent': any(b['role'] == 'roles/datastore.importExportAdmin' and 'serviceAccount:' + DEFAULT in b.get('members', []) for b in policy.get('bindings', []))}
        print(json.dumps(report, indent=2))
        if not report['ready']:
            raise SystemExit(2)
        return

    if not ready:
        raise RuntimeError('Dedicated backup identity is not ready; shared role was not removed')
    fn = request(f'https://cloudfunctions.googleapis.com/v2/projects/{PROJECT}/locations/us-central1/functions/scheduledFirestoreExport')
    if fn.get('state') != 'ACTIVE' or fn.get('serviceConfig', {}).get('serviceAccountEmail') != ACCOUNT:
        raise RuntimeError('Dedicated backup function is not active; shared role was not removed')
    day = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    backup = request(f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/backupRuns/{day}')['fields']
    completed = backup.get('completedAt', {}).get('timestampValue', '')
    if (backup.get('status', {}).get('stringValue') != 'completed'
            or backup.get('serviceAccount', {}).get('stringValue') != ACCOUNT
            or not completed or completed < fn.get('updateTime', '')
            or not backup.get('outputUriPrefix', {}).get('stringValue', '').startswith('gs://blastybiz-firestore-backups/')):
        raise RuntimeError('Fresh dedicated backup completion is not proven; shared role was not removed')
    changed = False
    for binding in policy.get('bindings', []):
        if binding['role'] == 'roles/datastore.importExportAdmin' and 'serviceAccount:' + DEFAULT in binding.get('members', []):
            binding['members'].remove('serviceAccount:' + DEFAULT)
            changed = True
    policy['bindings'] = [b for b in policy.get('bindings', []) if b.get('members')]
    if changed:
        request(RESOURCE + ':setIamPolicy', 'POST', {'policy': policy})
    print('Removed the shared runtime import/export role after dedicated backup verification.')


if __name__ == '__main__':
    main()

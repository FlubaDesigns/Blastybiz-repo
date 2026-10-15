import importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('scope',Path(__file__).with_name('classify-layout.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class LayoutScope(unittest.TestCase):
    def test_copy_classes_and_containers(self):
        a='<div id="x" class="old"><button onclick="save()">Old</button></div><script>secure();</script>'
        b='<section><div id="x" class="new"><button onclick="save()">New</button></div></section><script>secure();</script>'
        self.assertTrue(m.eligible('public/BlastyBiz.html',a,b))
    def test_runtime_changes_always_full(self):
        for a,b in [('<script>secure();</script>','<script>skip();</script>'),('<button onclick="save()">A</button>','<button onclick="publish()">A</button>'),('<form action="/safe">','<form action="/other">'),('<input type="password">','<input type="text">'),('<iframe sandbox>','<iframe>'),('<script src="auth.js"></script>','<script src="other.js"></script>'),('<div id="gate">','<div id="other">'),('<button disabled>','<button>')]:
            with self.subTest(a=a):self.assertFalse(m.eligible('public/BlastyBiz.html',a,b))
    def test_unknown_sensitive_added_deleted_and_renamed_are_full(self):
        for p in ['functions/index.js','public/blastybiz-menu.js','public/BlastyBiz-Login.html','public/BlastyBiz-Admin.html','public/image.svg','scripts/test-x.cjs','.github/workflows/check-release.yml','firebase.json']:
            self.assertFalse(m.eligible(p,'a','b'))
        for status in ['A','D','R100']:
            self.assertFalse(m.eligible('public/global-style.css','','',status))
    def test_styles_and_bitmap_assets(self):
        for p in ['public/global-style.css','public/img/logo.png']:
            self.assertTrue(m.eligible(p,'a','b'))
    def test_missing_baseline_fails_closed(self):
        self.assertEqual(m.classify('', 'a'*40)['mode'],'full')
if __name__=='__main__':unittest.main()

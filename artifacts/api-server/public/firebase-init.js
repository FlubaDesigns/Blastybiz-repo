import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

const firebaseConfig = {
  apiKey: "AIzaSyCyEwA6jGHp0xjAJO3NOXHblYfpajtFXGM",
  authDomain: "blastybiz-9523e.web.app",
  projectId: "blastybiz-9523e",
  storageBucket: "blastybiz-9523e.firebasestorage.app",
  messagingSenderId: "745597683278",
  appId: "1:745597683278:web:90847f6981e982dc54251f"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

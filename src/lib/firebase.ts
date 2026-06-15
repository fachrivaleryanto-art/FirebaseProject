import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, get } from "firebase/database";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDxz9i6eoLwEL-EUJT-_ug9Ec4BaqqO3Gs",
  authDomain: "iot-firebase-84e63.firebaseapp.com",
  databaseURL: "https://iot-firebase-84e63-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "iot-firebase-84e63",
  storageBucket: "iot-firebase-84e63.firebasestorage.app",
  messagingSenderId: "636719716922",
  appId: "1:636719716922:web:b1d153e81f58e2390f3303",
  measurementId: "G-P1CL35Q16F"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { database, ref, set, onValue, get, auth, googleProvider };

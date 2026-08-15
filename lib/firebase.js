import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function privateKey() {
  return required("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");
}

const app =
  getApps()[0] ||
  initializeApp({
    credential: cert({
      projectId: required("FIREBASE_PROJECT_ID"),
      clientEmail: required("FIREBASE_CLIENT_EMAIL"),
      privateKey: privateKey()
    }),
    databaseURL: required("FIREBASE_DATABASE_URL")
  });

export const adminAuth = getAuth(app);
export const db = getDatabase(app);

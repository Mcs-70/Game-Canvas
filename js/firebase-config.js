// Game Canvas — Firebase project config for Trio's "Play with a Friend" mode.
//
// Fill these in with your own Firebase project's values (Project settings >
// General > Your apps > SDK setup and configuration > Config). These are
// public client identifiers, not secrets — Firebase protects data through
// Realtime Database rules, not by hiding this config.
//
// See the setup steps in trio-multiplayer.html's comments / project README
// for how to create the project and enable Realtime Database.

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

export function isFirebaseConfigured() {
  return firebaseConfig.apiKey !== "YOUR_API_KEY" && !!firebaseConfig.apiKey;
}

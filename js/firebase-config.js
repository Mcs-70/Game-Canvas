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
  apiKey: "AIzaSyAVTASz9FmvzIx0ihuN9t7BMyuefyEddT8",
  authDomain: "game-canvas-1b1d8.firebaseapp.com",
  databaseURL: "https://game-canvas-1b1d8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "game-canvas-1b1d8",
  storageBucket: "game-canvas-1b1d8.firebasestorage.app",
  messagingSenderId: "1029934905027",
  appId: "1:1029934905027:web:a1d8b16b076fbb141a1476",
};

export function isFirebaseConfigured() {
  return firebaseConfig.apiKey !== "YOUR_API_KEY" && !!firebaseConfig.apiKey;
}

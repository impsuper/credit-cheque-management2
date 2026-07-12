// firebase-messaging-sw.js
// Handles push notifications received while the app is closed / in the background.
// Must live at the root of the site (same folder as index.html) so its scope covers the whole app.

importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyACVRZKKb-Vpq7eeKu0VW2xfFBmkS4rvD4",
  authDomain: "impcreditapp.firebaseapp.com",
  projectId: "impcreditapp",
  storageBucket: "impcreditapp.firebasestorage.app",
  messagingSenderId: "630921966784",
  appId: "1:630921966784:web:8ae8f663ee25572b4d2925"
});

const messaging = firebase.messaging();

// Background message handler (app closed / not focused)
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || payload.data?.title || 'IMP Super City';
  const body = payload.notification?.body || payload.data?.body || '';
  self.registration.showNotification(title, {
    body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: payload.data || {}
  });
});

// Focus/open the app when the notification is tapped
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./index.html');
    })
  );
});

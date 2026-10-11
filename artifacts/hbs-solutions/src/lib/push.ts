import { deletePushSubscription, getPushKey, savePushSubscription } from '@workspace/api-client-react';
import { basePath } from '@/App';

// Web Push on this device: the service worker (public/sw.js) shows the
// notification and opens the portal page it points to. The server keeps one
// subscription per endpoint; the VAPID key comes from it, so the browser only
// ever subscribes against the office's own key.

export type PushState = 'unsupported' | 'unavailable' | 'blocked' | 'off' | 'on';

// The VAPID public key is URL-safe base64; PushManager wants raw bytes.
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const swUrl = () => `${basePath}/sw.js`;
export const swScope = () => `${basePath}/`;

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
// Safari on iPhone/iPad only delivers push to sites added to the home screen.
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
}
export function isStandalone(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(swUrl(), { scope: swScope() });
  return navigator.serviceWorker.ready;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const existing = await navigator.serviceWorker.getRegistration(swScope());
    const subscription = await existing?.pushManager.getSubscription();
    return subscription ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'blocked';
  const { publicKey } = await getPushKey();
  if (!publicKey) return 'unavailable';
  const reg = await registration();
  const subscription = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource }));
  const json = subscription.toJSON();
  const keys = json.keys ?? {};
  if (!json.endpoint || !keys.p256dh || !keys.auth) throw new Error('push subscription without keys');
  await savePushSubscription({ endpoint: json.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, userAgent: navigator.userAgent.slice(0, 512) });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const existing = await navigator.serviceWorker.getRegistration(swScope());
  const subscription = await existing?.pushManager.getSubscription();
  if (!subscription) return 'off';
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  // The server row goes too; a failure there only means one extra push that
  // the browser now drops, and the server deletes the subscription on 410.
  try { await deletePushSubscription({ endpoint }); } catch { /* see above */ }
  return 'off';
}

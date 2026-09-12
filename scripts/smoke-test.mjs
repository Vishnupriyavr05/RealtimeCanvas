/**
 * Integration smoke test: simulates two clients against a running server.
 * Usage: node scripts/smoke-test.mjs [baseUrl]
 */
import { io } from 'socket.io-client';

const BASE = process.argv[2] ?? 'http://localhost:4000';
// Fresh rooms per run: the server keeps history for rooms it has already seen.
const rand4 = () => Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '7').replace(/[^A-Z0-9]/g, '7');
const ROOM_A = `SM${rand4()}`;
const ROOM_B = `IS${rand4()}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return io(BASE, { transports: ['websocket'] });
}

function waitFor(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

const a = connect();
const b = connect();

await Promise.all([waitFor(a, 'connect'), waitFor(b, 'connect')]);
console.log('both clients connected');

// 1. A joins ROOM_A
const joinA = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('join ack timeout')), 3000);
  a.emit('room:join', ROOM_A, (res) => {
    clearTimeout(t);
    resolve(res);
  });
});
check('A join ack ok', joinA?.ok === true);

// 2. B joins ROOM_A → receives history + A sees peer-joined
// Register the peer-joined listener BEFORE B joins (the server emits it
// synchronously during B's join handling).
const peerJoinedPromise = waitFor(a, 'room:peer-joined');
const joinedB = waitFor(b, 'room:joined');
const bJoin = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('join ack timeout')), 3000);
  b.emit('room:join', ROOM_A, (res) => {
    clearTimeout(t);
    resolve(res);
  });
});
check('B join ack ok', bJoin?.ok === true);
const bJoined = await joinedB;
check('B received history replay (empty)', Array.isArray(bJoined.history) && bJoined.history.length === 0);
const peerJoined = await peerJoinedPromise;
check('A notified of B join', !!peerJoined?.id);

// 3. A draws a stroke → B receives it
const stroke = {
  kind: 'stroke',
  tool: 'pen',
  color: '#ff0000',
  width: 4,
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.2 },
    { x: 0.3, y: 0.1 },
  ],
};
const drawOnB = waitFor(b, 'draw');
a.emit('draw', stroke);
const drawEntry = await drawOnB;
check('B received A stroke', drawEntry?.op?.kind === 'stroke' && drawEntry.clientId === a.id);

// 4. Room isolation: C joins ROOM_B; B must NOT receive C's ops
const c = connect();
await waitFor(c, 'connect');
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('join ack timeout')), 3000);
  c.emit('room:join', ROOM_B, (res) => {
    clearTimeout(t);
    resolve(res);
  });
});
let bSawForeign = false;
b.once('draw', () => {
  bSawForeign = true;
});
c.emit('draw', {
  kind: 'stroke',
  tool: 'pen',
  color: '#00ff00',
  width: 2,
  points: [{ x: 0.5, y: 0.5 }],
});
await wait(400);
check('room isolation: B did not receive C op', bSawForeign === false);

// 5. Late joiner history: D joins ROOM_A and must receive A's stroke
const d = connect();
await waitFor(d, 'connect');
const dJoin = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('join ack timeout')), 3000);
  d.emit('room:join', ROOM_A, (res) => {
    clearTimeout(t);
    resolve(res);
  });
});
check('late joiner receives history', dJoin?.ok === true && dJoin.history.length >= 1);

// 6. Malformed ops are rejected and don't crash the server
const rejected = waitFor(a, 'draw:rejected');
a.emit('draw', { kind: 'stroke', tool: 'pen', color: 'javascript:alert(1)', width: 4, points: [{ x: 0.5, y: 0.5 }] });
const rej = await rejected;
check('malformed color rejected', typeof rej?.reason === 'string');

let cAliveAfterMalformed = false;
const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
cAliveAfterMalformed = health.ok === true;
check('server healthy after malformed event', cAliveAfterMalformed);

// 7. Clear sync: A clears → B receives clear event
const clearOnB = waitFor(b, 'clear');
a.emit('clear');
const clearEntry = await clearOnB;
check('B received clear', clearEntry?.clientId === a.id);

// 8. Cursor sync: A cursor → B receives
const cursorOnB = waitFor(b, 'cursor');
a.emit('cursor', 0.42, 0.77);
const cursorEntry = await cursorOnB;
check('B received A cursor', Math.abs(cursorEntry?.x - 0.42) < 1e-9);

// 9. Out-of-range cursor is dropped
let bGotBadCursor = false;
b.once('cursor', (e) => {
  if (e.x > 1) bGotBadCursor = true;
});
a.emit('cursor', 5, 5);
await wait(300);
check('out-of-range cursor dropped', bGotBadCursor === false);

// 10. Disconnect handling: D disconnects → A sees peer-left
const peerLeft = waitFor(a, 'room:peer-left');
d.disconnect();
const left = await peerLeft;
check('A notified of D leaving', !!left?.id);

// 11. Reconnect resync: A disconnects and rejoins, gets full history
const bStroke = { kind: 'shape', tool: 'rectangle', style: 'stroke', color: '#0000ff', width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }] };
b.emit('draw', bStroke);
await wait(200);
a.disconnect();
await wait(300);
a.connect();
await waitFor(a, 'connect');
const reJoin = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('join ack timeout')), 3000);
  a.emit('room:join', ROOM_A, (res) => {
    clearTimeout(t);
    resolve(res);
  });
});
check('rejoin delivers history', reJoin?.ok === true && reJoin.history.some((op) => op.kind === 'shape'));

// 12. Invalid room id is rejected
const badJoin = await new Promise((resolve) => {
  a.emit('room:join', 'INVALID ID!', (res) => resolve(res));
});
check('invalid room id rejected', badJoin?.ok === false);

[a, b, c, d].forEach((s) => s.disconnect());
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

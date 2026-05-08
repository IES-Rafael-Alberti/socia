import type { Server as HTTPServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { db } from './db.js';
import { verifyAdminCookie } from './auth-helpers.js';

interface AdminClient {
  ws: WebSocket;
  kind: 'admin';
}
interface StudentClient {
  ws: WebSocket;
  kind: 'student';
  studentId: string;
  classId: string;
}
type Client = AdminClient | StudentClient;

const clients = new Set<Client>();

export function attachWS(server: HTTPServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const pathName = url.pathname;
    if (pathName === '/ws/admin') {
      const cookieHeader = req.headers.cookie ?? '';
      if (!verifyAdminCookie(cookieHeader)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const client: AdminClient = { ws, kind: 'admin' };
        clients.add(client);
        ws.on('close', () => clients.delete(client));
        ws.send(JSON.stringify({ type: 'hello', role: 'admin' }));
      });
    } else if (pathName === '/ws/student') {
      const token = url.searchParams.get('token');
      if (!token) {
        socket.destroy();
        return;
      }
      const row = db
        .prepare('SELECT id, class_id AS classId FROM students WHERE token = ?')
        .get(token) as { id: string; classId: string } | undefined;
      if (!row) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const client: StudentClient = {
          ws,
          kind: 'student',
          studentId: row.id,
          classId: row.classId,
        };
        clients.add(client);
        db.prepare('UPDATE students SET last_seen_at = ? WHERE id = ?').run(Date.now(), row.id);
        ws.on('close', () => clients.delete(client));
        ws.send(JSON.stringify({ type: 'hello', role: 'student' }));
      });
    } else {
      socket.destroy();
    }
  });
}

export function broadcastAdmins(payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const c of clients) {
    if (c.kind === 'admin' && c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
  }
}

export function sendToClass(classId: string, payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const c of clients) {
    if (c.kind === 'student' && c.classId === classId && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(msg);
    }
  }
}

export function sendToStudent(studentId: string, payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const c of clients) {
    if (c.kind === 'student' && c.studentId === studentId && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(msg);
    }
  }
}

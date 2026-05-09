import { createServer } from '../src/server.mjs';
import { createMockDashboard, createMockNotifications } from './mock-dashboard-data.mjs';

const port = Number.parseInt(process.env.PORT || '4629', 10);
const host = process.env.HOST || '127.0.0.1';

const notificationCenter = {
  async refresh() {
    return createMockNotifications();
  },
  async updateNotification(id, patch = {}) {
    return { id, ...patch };
  },
  async updateSettings(patch = {}) {
    return {
      desktopNotificationsEnabled: true,
      privacyMode: true,
      ...patch,
    };
  },
  async sendTestNotification() {
    return { sent: true };
  },
};

const server = createServer({
  loadDashboard: async () => createMockDashboard(),
  notificationCenter,
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`Agent Mission Control mock dashboard: http://${host}:${actualPort}`);
});

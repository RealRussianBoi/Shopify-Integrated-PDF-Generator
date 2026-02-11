import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', {
  withCredentials: true,
  autoConnect: true, // default
  transports: ['websocket'], // force WebSocket (optional)
});

export default socket;
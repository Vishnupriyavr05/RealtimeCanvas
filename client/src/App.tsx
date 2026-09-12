import { useState } from 'react';
import { useSocket } from './hooks/useSocket';
import { useRoomConnection } from './hooks/useRoomConnection';
import { Lobby } from './components/Room/Lobby';
import { RoomScreen } from './components/Room/RoomScreen';

export default function App() {
  const { state } = useSocket();
  const room = useRoomConnection();
  const [roomId, setRoomId] = useState<string | null>(null);

  const handleJoin = async (id: string) => {
    const res = await room.join(id);
    if (res.ok) setRoomId(id.trim().toUpperCase());
    return res;
  };

  const handleLeave = () => {
    room.leave();
    setRoomId(null);
  };

  if (roomId) {
    return <RoomScreen roomId={roomId} room={room} onLeave={handleLeave} />;
  }

  return <Lobby onJoin={handleJoin} connectionState={state} />;
}

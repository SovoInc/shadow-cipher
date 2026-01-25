import { createFileRoute } from '@tanstack/react-router';
import { ShadowCipher } from '@/pages/shadowcipher';

export const Route = createFileRoute('/shadowcipher')({
  component: ShadowCipher,
});

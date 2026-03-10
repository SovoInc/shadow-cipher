import { createFileRoute } from '@tanstack/react-router';
import { Counter } from '@/pages/counter';
import { CounterAppProvider } from '@/modules/midnight/counter-sdk/contexts';
import { logger } from './__root';

const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS!;

export const Route = createFileRoute('/counter')({
  component: () => (
    <CounterAppProvider logger={logger} contractAddress={contractAddress}>
      <Counter />
    </CounterAppProvider>
  ),
});

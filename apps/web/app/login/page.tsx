import { LoginForm } from '@/components/client';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <main className="login">
      <LoginForm />
    </main>
  );
}

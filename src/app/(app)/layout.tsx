import AppShell from '@/components/AppShell';
import QuestionSoundListener from '@/components/QuestionSoundListener';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <QuestionSoundListener />
      {children}
    </AppShell>
  );
}

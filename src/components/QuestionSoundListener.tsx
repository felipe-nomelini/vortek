'use client';

import { useEffect } from 'react';

const QUESTION_SOUND = '/sounds/ala-nem-vou-ler-ines-brasil.mp3';

export default function QuestionSoundListener() {
  useEffect(() => {
    const audio = new Audio(QUESTION_SOUND);
    audio.preload = 'auto';

    const unlockAudio = () => {
      audio.muted = true;
      void audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      }).catch(() => {
        audio.muted = false;
      });
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };

    const playQuestionSound = (event: MessageEvent<{ type?: string; eventType?: string }>) => {
      if (event.data?.type !== 'vortek-push' || event.data?.eventType !== 'new_question') return;
      audio.currentTime = 0;
      void audio.play().catch(() => null);
    };

    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    navigator.serviceWorker?.addEventListener('message', playQuestionSound);

    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      navigator.serviceWorker?.removeEventListener('message', playQuestionSound);
      audio.pause();
    };
  }, []);

  return null;
}

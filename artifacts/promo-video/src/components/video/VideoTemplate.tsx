import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

export const SCENE_DURATIONS = {
  intro: 5000,
  musicQueue: 7000,
  voiceovers: 7000,
  fleet: 7000,
  outro: 6000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  intro: Scene1,
  musicQueue: Scene2,
  voiceovers: Scene3,
  fleet: Scene4,
  outro: Scene5,
};

const scenePos = [
  { x: '10vw', y: '10vh', scale: 2, opacity: 0.2, rotate: 0 },
  { x: '70vw', y: '20vh', scale: 1.5, opacity: 0.15, rotate: 45 },
  { x: '30vw', y: '60vh', scale: 1.2, opacity: 0.2, rotate: 90 },
  { x: '80vw', y: '70vh', scale: 2.5, opacity: 0.1, rotate: 135 },
  { x: '50vw', y: '50vh', scale: 3, opacity: 0.2, rotate: 180 },
];

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENE_DURATIONS;
  const sceneIndex = Object.keys(SCENE_DURATIONS).indexOf(baseSceneKey);
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];
  const safeIndex = sceneIndex >= 0 ? sceneIndex : 0;

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black font-display text-white">
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 z-0">
        <motion.div
          className="absolute w-[800px] h-[800px] rounded-full opacity-30 blur-[100px]"
          style={{ background: 'radial-gradient(circle, #00f0ff, transparent)' }}
          animate={{
            x: ['-20%', '80%', '10%'],
            y: ['10%', '60%', '-10%'],
            scale: [1, 1.5, 0.8],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute w-[600px] h-[600px] rounded-full opacity-30 blur-[100px] right-0 bottom-0"
          style={{ background: 'radial-gradient(circle, #ff00d4, transparent)' }}
          animate={{
            x: ['20%', '-60%', '0%'],
            y: ['-20%', '-80%', '10%'],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div
          className="absolute inset-0 opacity-20 mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Persistent midground layer */}
      <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
        <motion.div
          className="absolute w-[40vw] h-[40vw] border-[1px] border-[#00f0ff]/20 rounded-full"
          animate={scenePos[safeIndex]}
          transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.div
          className="absolute w-[30vw] h-[30vw] border-[1px] border-[#ff00d4]/20 rounded-full"
          animate={{
            ...scenePos[safeIndex],
            scale: scenePos[safeIndex].scale * 0.8,
            rotate: scenePos[safeIndex].rotate * -1,
          }}
          transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      {/* Foreground Scenes */}
      <div className="absolute inset-0 z-20">
        <AnimatePresence initial={false} mode="popLayout">
          {SceneComponent && <SceneComponent key={currentSceneKey} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

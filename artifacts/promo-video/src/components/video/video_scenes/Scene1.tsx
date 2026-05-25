import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import neonLogo from '../../../../../dj-booth/public/public/neon-ai-dj-logo.jpeg';
import bootScreen from '../../../../../dj-booth/public/opengraph.jpg';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2800),
      setTimeout(() => setPhase(4), 4000), 
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.5 }}
    >
      <div className="absolute inset-0 z-0">
        <motion.img 
          src={bootScreen} 
          className="w-full h-full object-cover opacity-30"
          animate={{ scale: [1, 1.1] }}
          transition={{ duration: 5, ease: 'linear' }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/30" />
      </div>

      <motion.div 
        className="relative z-10 w-[15vw] h-[15vw] mb-8 rounded-full overflow-hidden border-2 border-[#00f0ff] box-glow-cyan"
        initial={{ scale: 0, rotate: -180 }}
        animate={phase >= 1 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -180 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      >
        <img src={neonLogo} alt="Neon AI DJ Logo" className="w-full h-full object-cover mix-blend-screen" />
      </motion.div>

      <div className="relative z-10 text-center" style={{ perspective: '1000px' }}>
        <motion.h1 
          className="text-[6vw] font-black tracking-tighter text-glow-magenta text-[#ff00d4] leading-none mb-4"
          initial={{ opacity: 0, y: 50, rotateX: -90 }}
          animate={phase >= 2 ? { opacity: 1, y: 0, rotateX: 0 } : { opacity: 0, y: 50, rotateX: -90 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          NEON AI DJ
        </motion.h1>
        <motion.p 
          className="text-[2vw] text-[#00f0ff] font-mono tracking-widest uppercase"
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={phase >= 3 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(10px)' }}
          transition={{ duration: 0.8 }}
        >
          AUTONOMOUS NIGHTCLUB SYSTEM
        </motion.p>
      </div>
    </motion.div>
  );
}

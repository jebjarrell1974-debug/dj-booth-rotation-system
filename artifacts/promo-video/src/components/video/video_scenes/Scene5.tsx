import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import neonLogo from '../../../../../dj-booth/public/public/neon-ai-dj-logo.jpeg';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-black"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute inset-0 neon-grid opacity-30 z-0 pointer-events-none" />

      <motion.div
        className="w-[15vw] h-[15vw] mb-8 rounded-full overflow-hidden border-2 border-[#00f0ff] box-glow-cyan z-10 relative"
        initial={{ scale: 0.5, opacity: 0, rotate: 180 }}
        animate={phase >= 1 ? { scale: 1, opacity: 1, rotate: 0 } : { scale: 0.5, opacity: 0, rotate: 180 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      >
        <img src={neonLogo} alt="Neon AI DJ Logo" className="w-full h-full object-cover mix-blend-screen" />
      </motion.div>

      <motion.div
        className="text-[5vw] font-black tracking-tighter text-glow-magenta mb-4 text-[#ff00d4] uppercase z-10 relative"
        initial={{ opacity: 0, y: 20, scale: 0.9 }}
        animate={phase >= 2 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 20, scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        NEON AI DJ
      </motion.div>

      <motion.div
        className="text-[2vw] text-[#00f0ff] font-mono tracking-widest uppercase z-10 relative"
        initial={{ opacity: 0, y: 10 }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
        transition={{ duration: 0.5 }}
      >
        YOUR CLUB, AUTOMATED.
      </motion.div>
    </motion.div>
  );
}

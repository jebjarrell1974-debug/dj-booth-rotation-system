import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import consoleImg from '../../../../../../attached_assets/79937861058__C40AD8B1-022C-434D-8576-43A09EAC5D34_1777720482196.jpeg';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200), // Image reveal
      setTimeout(() => setPhase(2), 1000), // Text
      setTimeout(() => setPhase(3), 1500), // Nodes
      setTimeout(() => setPhase(4), 6000), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const venues = ['EVANSVILLE', 'CHICAGO', 'DETROIT', 'INDY', 'COLUMBUS'];

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 100, damping: 20 }}
    >
      <div className="absolute inset-0 z-0">
        <motion.div 
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${consoleImg})` }}
          initial={{ scale: 1.2, opacity: 0 }}
          animate={phase >= 1 ? { scale: 1, opacity: 0.4 } : { scale: 1.2, opacity: 0 }}
          transition={{ duration: 2, ease: 'easeOut' }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/90 to-black/30" />
      </div>

      <div className="w-[50%] px-[10vw] z-10 relative">
        <motion.div 
          className="text-[#00f0ff] font-mono tracking-widest mb-4 flex items-center gap-3 text-xl"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        >
          <div className="w-3 h-3 rounded-full bg-[#00f0ff] animate-ping box-glow-cyan" />
          FLEET COMMAND
        </motion.div>
        
        <motion.h2 
          className="text-[4.5vw] font-black leading-none mb-6 text-white text-glow-cyan uppercase"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ type: 'spring', delay: 0.1 }}
        >
          MANAGE<br/>EVERY VENUE
        </motion.h2>
        
        <motion.p 
          className="text-[1.5vw] text-white/70"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.3 }}
        >
          Control multiple clubs from one dashboard. <br/>Dell OptiPlex edge nodes handle the heavy lifting locally.
        </motion.p>
      </div>

      <div className="w-[50%] h-full flex flex-col justify-center px-[5vw] gap-4 z-10 relative">
        {venues.map((venue, i) => (
          <motion.div
            key={venue}
            className={`bg-black/60 border p-4 rounded-lg flex items-center justify-between backdrop-blur-xl ${
              i === 0 ? 'border-[#ff00d4] box-glow-magenta bg-[#ff00d4]/10' : 'border-white/10'
            }`}
            initial={{ opacity: 0, x: 50 }}
            animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: 50 }}
            transition={{ delay: i * 0.1, type: 'spring', stiffness: 200, damping: 20 }}
          >
            <div className="flex items-center gap-4">
              <div className={`w-4 h-4 rounded-full ${i === 0 ? 'bg-[#ff00d4] box-glow-magenta animate-pulse' : 'bg-[#00f0ff] box-glow-cyan'}`} />
              <span className="font-mono text-[1.2vw] text-white font-bold tracking-wider">{venue} NODE</span>
            </div>
            <span className="font-mono text-white/70 text-[1vw] uppercase">
              {i === 0 ? 'ACTIVE / STREAMING' : 'STANDBY'}
            </span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

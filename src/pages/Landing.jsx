import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Music2, Users, Delete, ArrowLeft, Wifi, Server } from 'lucide-react';
import { setBoothIp, getBoothIp } from '@/api/serverApi';

function PinPad({ onSubmit, onBack, label, error, loading }) {
  const [pin, setPin] = useState('');

  const handleDigit = useCallback((d) => {
    setPin(prev => prev.length < 5 ? prev + d : prev);
  }, []);

  const handleDelete = useCallback(() => {
    setPin(prev => prev.slice(0, -1));
  }, []);

  useEffect(() => {
    if (pin.length === 5) {
      onSubmit(pin);
      setTimeout(() => setPin(''), 500);
    }
  }, [pin, onSubmit]);

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-xs mx-auto">
      <button onClick={onBack} className="self-start flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>
      <p className="text-lg font-semibold text-white">{label}</p>
      
      <div className="flex gap-3 justify-center">
        {[0,1,2,3,4].map(i => (
          <div key={i} className={`w-12 h-14 rounded-lg border-2 flex items-center justify-center text-2xl font-bold transition-colors ${
            i < pin.length ? 'border-[#e040fb] bg-[#e040fb]/20 text-[#e040fb]' : 'border-[#1e1e3a] bg-[#0d0d1f] text-gray-600'
          }`}>
            {i < pin.length ? '\u2022' : ''}
          </div>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm text-center">{error}</p>}

      <div className="grid grid-cols-3 gap-3 w-full">
        {[1,2,3,4,5,6,7,8,9].map(d => (
          <button
            key={d}
            onClick={() => handleDigit(String(d))}
            disabled={loading}
            className="h-16 rounded-xl bg-[#151528] border border-[#1e1e3a] text-white text-2xl font-semibold hover:bg-[#1e1e3a] active:bg-[#e040fb]/20 transition-colors"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          onClick={() => handleDigit('0')}
          disabled={loading}
          className="h-16 rounded-xl bg-[#151528] border border-[#1e1e3a] text-white text-2xl font-semibold hover:bg-[#1e1e3a] active:bg-[#e040fb]/20 transition-colors"
        >
          0
        </button>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="h-16 rounded-xl bg-[#151528] border border-[#1e1e3a] text-gray-400 flex items-center justify-center hover:bg-[#1e1e3a] hover:text-white transition-colors"
        >
          <Delete className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}

export default function Landing() {
  const [mode, setMode] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [boothIpInput, setBoothIpInput] = useState(getBoothIp());
  const { login, initDjPin, isAuthenticated, role } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      if (role === 'dj') navigate('/DJBooth');
      else if (role === 'dancer') navigate('/DancerView');
    }
  }, [isAuthenticated, role, navigate]);

  const handleDJLogin = useCallback(async (pin) => {
    setError('');
    setLoading(true);
    try {
      const isRemote = mode === 'dj-remote';
      if (isRemote) {
        setBoothIp(boothIpInput || '');
      }
      await login('dj', pin, { remote: isRemote });
    } catch (loginErr) {
      if (loginErr.message && (loginErr.message.includes('No DJ PIN') || loginErr.message.includes('not set'))) {
        try {
          await initDjPin(pin);
        } catch (initErr) {
          setError(initErr.message || 'Failed to set PIN');
        }
      } else {
        setError(loginErr.message || 'Incorrect PIN');
      }
    }
    setLoading(false);
  }, [login, initDjPin, mode, boothIpInput]);

  const handleDancerLogin = useCallback(async (pin) => {
    setError('');
    setLoading(true);
    try {
      await login('dancer', pin);
    } catch (err) {
      setError(err.message || 'Incorrect PIN');
    }
    setLoading(false);
  }, [login]);

  return (
    <div className="min-h-screen bg-[#08081a] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {!mode ? (
          <div className="flex flex-col items-center gap-8">
            <div className="text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#e040fb] to-[#7c3aed] flex items-center justify-center mx-auto mb-4">
                <Music2 className="w-10 h-10 text-black" />
              </div>
              <h1 className="text-3xl font-bold text-white">DJ Booth</h1>
              <p className="text-gray-500 text-sm mt-1">Enter your PIN to continue</p>
            </div>

            <div className="flex flex-col gap-4 w-full">
              <Button
                onClick={() => setMode('dj')}
                className="h-16 text-lg font-semibold bg-gradient-to-r from-[#e040fb] to-[#7c3aed] hover:from-[#c026d3] hover:to-[#6d28d9] text-black"
              >
                <Music2 className="w-5 h-5 mr-3" />
                DJ Booth
              </Button>
              <Button
                onClick={() => setMode('dj-remote')}
                variant="outline"
                className="h-16 text-lg font-semibold border-[#7c3aed] bg-[#7c3aed]/10 text-[#e040fb] hover:bg-[#7c3aed]/20 hover:text-white"
              >
                <Wifi className="w-5 h-5 mr-3" />
                DJ / Manager Remote
              </Button>
              <Button
                onClick={() => setMode('dancer')}
                variant="outline"
                className="h-16 text-lg font-semibold border-[#1e1e3a] bg-[#0d0d1f] text-white hover:bg-[#151528] hover:text-white"
              >
                <Users className="w-5 h-5 mr-3" />
                Dancer
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {mode === 'dj-remote' && (
              <div className="flex flex-col gap-2 px-4">
                <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                  <Server className="w-4 h-4" />
                  Booth IP Address
                </label>
                <input
                  type="text"
                  value={boothIpInput}
                  onChange={(e) => setBoothIpInput(e.target.value)}
                  placeholder="192.168.1.98"
                  className="w-full h-12 px-4 rounded-lg bg-[#0d0d1f] border-2 border-[#1e1e3a] text-white text-lg font-mono placeholder-gray-600 focus:border-[#7c3aed] focus:outline-none transition-colors"
                  inputMode="decimal"
                  autoComplete="off"
                  autoCorrect="off"
                />
                <p className="text-xs text-gray-600">
                  {boothIpInput ? `Connecting to ${boothIpInput}:3001` : 'Leave blank if on the same device'}
                </p>
              </div>
            )}
            <PinPad
              label={
                mode === 'dj' 
                  ? 'Enter DJ PIN'
                  : mode === 'dj-remote'
                  ? 'Enter DJ PIN (Remote)'
                  : 'Enter your Dancer PIN'
              }
              onSubmit={mode === 'dj' || mode === 'dj-remote' ? handleDJLogin : handleDancerLogin}
              onBack={() => { setMode(null); setError(''); }}
              error={error}
              loading={loading}
            />
          </div>
        )}
      </div>
    </div>
  );
}

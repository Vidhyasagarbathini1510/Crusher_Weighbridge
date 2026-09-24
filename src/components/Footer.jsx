import React from 'react';
import { useScale } from '../context/ScaleContext.jsx';

export default function Footer() {
  const {
    card, setCard,
    vehicle, setVehicle,
    gross, setGross,
    tare, setTare,
    nett,
    signalGo, setSignalGo,
    signalStop, setSignalStop,
    signalAlert, setSignalAlert
  } = useScale();

  const handleGo = () => {
    setSignalGo(true);
    setSignalStop(false);
  };

  const handleStop = () => {
    setSignalStop(true);
    setSignalGo(false);
  };

  const handleSignalToggle = () => {
    setSignalAlert(prev => !prev);
  };

  return (
    <div 
      className="d-flex align-items-center justify-content-start gap-3 w-100 border-top px-3 py-2 text-dark" 
      style={{
        backgroundColor: 'var(--surface-3)',
        fontSize: '0.9rem',
        zIndex: 100,
        height: '52px',
        flexShrink: 0
      }}
    >
      <div className="d-flex align-items-center gap-1.5">
        
        <span className="fw-semibold me-3">Card</span>
        <input 
          type="text" 
          className="form-control form-control-sm text-center bg-white fw-bold" 
          style={{ width: '130px', height: '30px', border: '1.5px solid var(--line-strong)' }}
          value={card} 
          onChange={(e) => setCard(e.target.value)} 
        />
      </div>

      <div className="d-flex align-items-center gap-1.5">
       
        <span className="fw-semibold me-3">Vehicle</span>
         <input 
          type="text" 
          className="form-control form-control-sm text-center bg-white font-monospace fw-bold" 
          style={{ width: '150px', height: '30px', border: '1.5px solid var(--line-strong)' }}
          value={vehicle} 
          onChange={(e) => setVehicle(e.target.value)} 
        />
      </div>

      <div className="d-flex align-items-center gap-1.5">
       
        <span className="fw-semibold me-3">Gross</span>
         <input 
          type="number" 
          className="form-control form-control-sm text-center bg-white fw-bold" 
          style={{ width: '110px', height: '30px', border: '1.5px solid var(--line-strong)' }}
          value={gross} 
          onChange={(e) => setGross(e.target.value)} 
        />
      </div>

      <div className="d-flex align-items-center gap-1.5">
        <span className="fw-semibold me-3">Tare</span>
        <input 
          type="number" 
          className="form-control form-control-sm text-center bg-white fw-bold" 
          style={{ width: '110px', height: '30px', border: '1.5px solid var(--line-strong)' }}
          value={tare} 
          onChange={(e) => setTare(e.target.value)} 
        />
       
      </div>

      <div className="d-flex align-items-center gap-1.5">
        
        <span className="fw-semibold me-4">Nett</span>
        <input 
          type="number" 
          className="form-control form-control-sm text-center bg-primary bg-opacity-10 fw-bold text-primary" 
          style={{ width: '110px', height: '30px', border: '1.5px solid var(--primary)' }}
          value={nett} 
          readOnly 
        />
      </div>

      <div className="d-flex align-items-center gap-2 ms-auto">
        <button 
          type="button" 
          onClick={handleGo}
          className="btn btn-sm fw-bold px-3 d-flex align-items-center justify-content-center text-white" 
          style={{ 
            backgroundColor: signalGo ? 'var(--success)' : 'var(--success-ink)',
            border: '1px solid #114A2E',
            minWidth: '70px',
            height: '30px',
            opacity: signalGo ? 1 : 0.8
          }}
        >
          GO
        </button>
        <button 
          type="button" 
          onClick={handleStop}
          className="btn btn-sm fw-bold px-3 d-flex align-items-center justify-content-center text-white" 
          style={{ 
            backgroundColor: signalStop ? 'var(--danger)' : 'var(--danger-ink)',
            border: '1px solid #6E160F',
            minWidth: '70px',
            height: '30px',
            opacity: signalStop ? 1 : 0.8
          }}
        >
          STOP
        </button>
        <button 
          type="button" 
          onClick={handleSignalToggle}
          className="btn btn-sm fw-bold px-3 d-flex align-items-center justify-content-center text-white" 
          style={{ 
            backgroundColor: signalAlert ? 'var(--danger)' : 'var(--danger-ink)',
            border: '1px solid #6E160F',
            minWidth: '70px',
            height: '30px',
            opacity: signalAlert ? 1 : 0.8
          }}
        >
          Signal
        </button>
      </div>
    </div>
  );
}

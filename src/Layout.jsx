import React from 'react';

export default function Layout({ children, currentPageName }) {
  return (
    <div className="min-h-screen bg-[#08081a]">
      <style>{`
        :root {
          --background: 0 0% 4%;
          --foreground: 0 0% 100%;
          --card: 0 0% 6%;
          --card-foreground: 0 0% 100%;
          --popover: 0 0% 6%;
          --popover-foreground: 0 0% 100%;
          --primary: 288 96% 61%;
          --primary-foreground: 0 0% 0%;
          --secondary: 0 0% 10%;
          --secondary-foreground: 0 0% 100%;
          --muted: 0 0% 15%;
          --muted-foreground: 0 0% 60%;
          --accent: 288 96% 61%;
          --accent-foreground: 0 0% 0%;
          --destructive: 0 62% 50%;
          --destructive-foreground: 0 0% 100%;
          --border: 0 0% 15%;
          --input: 0 0% 15%;
          --ring: 288 96% 61%;
          --radius: 0.5rem;
        }
        
        body {
          background-color: #08081a;
          color: white;
        }
        
        /* Custom scrollbar for dark theme */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: #0d0d1f;
        }
        ::-webkit-scrollbar-thumb {
          background: #1e293b;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #2e2e4a;
        }
        
        /* Slider styling */
        [data-orientation="horizontal"] [data-radix-slider-track] {
          background: #1e293b;
        }
        [data-orientation="horizontal"] [data-radix-slider-range] {
          background: #00d4ff;
        }
        [data-radix-slider-thumb] {
          background: #00d4ff;
          border: none;
        }
      `}</style>
      {children}
    </div>
  );
}
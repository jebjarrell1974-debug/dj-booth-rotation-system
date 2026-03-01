import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, Music2, Users, Layers, Mic, SlidersHorizontal, Settings, Radio, Monitor, Smartphone, FolderOpen, Zap, Shield, HelpCircle } from 'lucide-react';
import { createPageUrl } from '@/utils';

const sections = [
  {
    id: 'getting-started',
    icon: Zap,
    title: 'Getting Started',
    content: [
      {
        heading: 'Logging In',
        text: 'From the main screen, tap "DJ Booth" and enter your 5-digit DJ PIN to access the booth controls. Dancers tap "Dancer Login" and enter their own PIN. The default DJ PIN is set up in Configuration.'
      },
      {
        heading: 'First-Time Setup',
        text: 'After logging in as DJ, tap the gear icon (Settings) in the top-right corner to enter your ElevenLabs and OpenAI API keys. These enable AI voice announcements. Then visit Configuration (slider icon) to set your music folder path, club name, hours, and master PIN.'
      },
      {
        heading: 'Quick Start',
        text: 'Once your music path is set, the system scans your music automatically. Add dancers in the Dancers tab, build the rotation in the Rotation tab, and hit "Start Rotation" — the system handles the rest: music playback, announcements, and transitions.'
      }
    ]
  },
  {
    id: 'options-tab',
    icon: SlidersHorizontal,
    title: 'Options Tab',
    content: [
      {
        heading: 'Music Mode',
        text: 'Choose between "Dancer First" (plays from the dancer\'s personal playlist first, then fills with random tracks) or "Random" (picks from the full library). Dancer First is the default and recommended mode.'
      },
      {
        heading: 'Active Genres',
        text: 'Your music library is organized by folder — each top-level folder becomes a genre. Toggle genres on or off to control which folders the system pulls music from. This lets you match the vibe without manually picking every song.'
      },
      {
        heading: 'Songs Per Set',
        text: 'Controls how many songs each dancer gets per rotation set. The system auto-advances to the next dancer when the set is complete.'
      },
      {
        heading: 'Energy Level',
        text: 'Controls the energy level of AI announcements. "Auto" adjusts based on time of night — mellower early, higher energy during peak hours. You can override it manually with levels L1 (chill) through L5 (hype). The current level shows as a colored badge in the header.'
      }
    ]
  },
  {
    id: 'rotation-tab',
    icon: Layers,
    title: 'Rotation Tab',
    content: [
      {
        heading: 'Building the Rotation',
        text: 'The rotation is your lineup — the order dancers go on stage. Add dancers from the list at the bottom. Drag to reorder. The currently performing dancer is highlighted in cyan.'
      },
      {
        heading: 'Starting & Stopping',
        text: 'Hit "Start Rotation" in the header to begin. The system plays the first dancer\'s music, announces them, and automatically transitions to the next dancer when their set ends. Hit "Stop Rotation" to pause.'
      },
      {
        heading: 'Skip & Remove',
        text: 'Use the skip button (next track icon) to jump to the next dancer early. Remove a dancer from the rotation with the X button on their card without removing them from the system.'
      },
      {
        heading: 'Song Assignments',
        text: 'Each dancer in the rotation shows their assigned songs underneath their name. These come from their personal playlist (set up in the Dancers tab) or are auto-filled from the library.'
      },
      {
        heading: 'Break Songs',
        text: 'Set the number of break songs (0-3) between each dancer using the purple break buttons. When you press "Save All," empty break slots are automatically filled with random songs from the music library. If a genre folder is selected in Options, break songs come from that folder. Changing from 3 to 2 breaks and saving trims the extras. Setting to 0 and saving clears all break songs. You can also manually drag specific songs into break slots to override the auto-fill.'
      },
      {
        heading: 'Save All',
        text: 'Press "Save All" to save the current rotation order, song assignments, and break songs all at once. This also auto-populates any empty break song slots and pre-caches voice announcements for upcoming dancers.'
      }
    ]
  },
  {
    id: 'dancers-tab',
    icon: Users,
    title: 'Dancers Tab',
    content: [
      {
        heading: 'Adding Dancers',
        text: 'Tap "Add Dancer" and enter a stage name. Each dancer gets a unique color for easy identification. You can also set a dancer PIN so they can log in on their own device.'
      },
      {
        heading: 'Editing & Playlists',
        text: 'Tap the music icon on a dancer\'s card to open their playlist editor. Search the music library and add songs — these are the tracks that play during their sets when Music Mode is "Dancer First."'
      },
      {
        heading: 'Active vs Inactive',
        text: 'Toggle a dancer as active or inactive. Inactive dancers stay in the system but won\'t show up when building rotations. Useful for dancers who only work certain nights.'
      }
    ]
  },
  {
    id: 'library-tab',
    icon: Music2,
    title: 'Music Library',
    content: [
      {
        heading: 'How Music is Organized',
        text: 'The system scans the music folder you set in Configuration. Each subfolder becomes a "genre." For example, if your music path has folders like "Hip-Hop", "Pop", "Rock" — those become selectable genres in Options.'
      },
      {
        heading: 'FEATURE Folder',
        text: 'Create a folder called "FEATURE" in your music directory for feature performers. Songs in this folder play to their full length (up to 60 minutes) instead of the normal 3-minute cap. Perfect for guest DJs, live performers, or extended sets.'
      },
      {
        heading: 'Browsing & Playing',
        text: 'Browse by genre or search by name. Tap any track to play it immediately. The library shows total track count and you can scroll through all available music.'
      },
      {
        heading: 'Rescanning',
        text: 'If you add new music files to the folder, the system rescans automatically on startup. You can also trigger a rescan from Configuration.'
      }
    ]
  },
  {
    id: 'announcements-tab',
    icon: Mic,
    title: 'Announcements',
    content: [
      {
        heading: 'How It Works',
        text: 'The system uses AI to generate DJ-style announcements — intros when a dancer takes the stage, round calls during their set, outros when they finish, and transitions between dancers. These are spoken aloud through ElevenLabs voice synthesis.'
      },
      {
        heading: 'Automatic Announcements',
        text: 'When rotation is running, announcements play automatically at the right moments. The AI adapts its energy level based on time of night — mellower early on, high-energy during peak hours. Intros say the dancer\'s name 2-3 times (varied naturally so it doesn\'t sound robotic). Round 2 calls acknowledge the dancer is still on stage. Outros are short sendoffs.'
      },
      {
        heading: 'Manual Announcements',
        text: 'Use the manual announcement panel to type custom messages and have them spoken in the DJ voice. Great for drink specials, last call, or shout-outs.'
      },
      {
        heading: 'Club Specials',
        text: 'Enter your current specials (drink deals, VIP promos) in the Club Specials field on the Announcements tab. The AI weaves these into announcements naturally — especially during outro and transition calls.'
      },
      {
        heading: 'Voice Volume (Gain)',
        text: 'Announcements have a separate volume control from the music. The purple mic icon with +/- buttons adjusts voice gain from 50% to 300%. Default is 150% so announcements cut through the club noise. This setting is saved and syncs to the remote.'
      },
      {
        heading: 'Pronunciation',
        text: 'Some dancer names get mispronounced by the AI voice. The system has a built-in pronunciation map that automatically corrects common names (like Mia, Chaunte, Charisse, etc.). If a name is still mispronounced, it can be added to the map.'
      },
      {
        heading: 'Requirements',
        text: 'Announcements need both an ElevenLabs API key (for voice) and an OpenAI API key (for script generation). Enter these in Settings (gear icon). The system shows a warning banner if either is missing.'
      }
    ]
  },
  {
    id: 'settings',
    icon: Settings,
    title: 'Settings (Gear Icon)',
    content: [
      {
        heading: 'API Keys',
        text: 'Enter your ElevenLabs and OpenAI API keys here. These are saved locally on the device and persist across sessions. You only need to enter them once per device.'
      },
      {
        heading: 'ElevenLabs Voice ID',
        text: 'If you have a custom voice cloned in ElevenLabs, paste its Voice ID here. Otherwise it uses the default voice.'
      },
      {
        heading: 'Auto-Save',
        text: 'Settings save automatically as you type — no save button needed.'
      }
    ]
  },
  {
    id: 'configuration',
    icon: Shield,
    title: 'Configuration Page',
    content: [
      {
        heading: 'Accessing Configuration',
        text: 'Tap the slider icon in the top-right of the DJ Booth. Configuration requires the Master PIN (not the DJ PIN). This protects system-level settings from accidental changes.'
      },
      {
        heading: 'Club Info',
        text: 'Set your club name, open hour, and close hour. The AI uses these for time-aware announcements — it knows whether it\'s early in the night or peak hours and adjusts energy accordingly.'
      },
      {
        heading: 'Music Path',
        text: 'Set the folder path where your music files live. On a Raspberry Pi this is typically something like "/home/pi/Music". The system scans this folder and all subfolders for audio files.'
      },
      {
        heading: 'PIN Management',
        text: 'Change the DJ PIN (what the DJ enters to log in) and the Master PIN (what\'s needed to access Configuration). Keep the Master PIN private — it controls system settings and fleet updates.'
      },
      {
        heading: 'Script Model',
        text: 'Choose which AI model generates announcement scripts. "Auto" uses the built-in model (no API key needed for scripts, only for voice). Other options use OpenAI directly.'
      },
      {
        heading: 'Energy Level Override',
        text: 'The system auto-adjusts announcement energy based on time of night. Use the override to manually lock it to a specific energy level if you want to control the vibe directly.'
      },
      {
        heading: 'Voiceover Cache',
        text: 'Pre-generate voice announcements for all dancers so they play instantly during the show instead of generating on-the-fly. Useful for reducing delays during rotation.'
      },
      {
        heading: 'Remote Fleet Update',
        text: 'If you run multiple Raspberry Pi kiosks, add their IP addresses here. "Check All" pings each one, and "Update All" triggers a code update on every Pi at once — pulling the latest version from GitHub.'
      }
    ]
  },
  {
    id: 'rotation-display',
    icon: Radio,
    title: 'Rotation Display',
    content: [
      {
        heading: 'What It Is',
        text: 'A full-screen display showing the current rotation lineup. Open it from the "Open Display" button in the DJ Booth header. It\'s designed to be shown on a separate monitor or TV where dancers and staff can see who\'s up next.'
      },
      {
        heading: 'Auto-Refresh',
        text: 'The display updates automatically every few seconds — no need to refresh. As the DJ advances through the rotation, the display updates in real time.'
      }
    ]
  },
  {
    id: 'dancer-view',
    icon: Smartphone,
    title: 'Dancer View',
    content: [
      {
        heading: 'What It Is',
        text: 'A separate interface for dancers to manage their own playlists from their phone. Dancers log in with their personal PIN from the main screen.'
      },
      {
        heading: 'Building a Playlist',
        text: 'Dancers can browse the music library, search by name, and add songs to their personal playlist. They can reorder songs by dragging, and remove songs they don\'t want.'
      },
      {
        heading: 'How It Connects',
        text: 'When a dancer updates their playlist, it syncs to the DJ Booth automatically. The next time that dancer is up in rotation, their updated song choices are used.'
      },
      {
        heading: 'Auto-Logout',
        text: 'For security, the dancer view automatically logs out after 4 hours of inactivity.'
      }
    ]
  },
  {
    id: 'ipad-remote',
    icon: Monitor,
    title: 'iPad / Remote Control',
    content: [
      {
        heading: 'How It Works',
        text: 'Connect a second device (iPad, phone, tablet) to the same network as the main DJ booth Pi. On the second device, go to the DJ Booth and it automatically detects it\'s remote and switches to remote control mode.'
      },
      {
        heading: 'What You Can Do Remotely',
        text: 'From the remote, you can skip dancers, adjust music volume (+/-), adjust voice volume (+/-), toggle announcements, and see the current song with a live countdown timer. Volume and skip controls are instant via real-time connection. Rotation and song changes take effect after pressing "Save All."'
      },
      {
        heading: 'Setting the Booth IP',
        text: 'On the login screen, tap the "Set Booth IP" option to enter the IP address of the main booth (Pi). The remote connects to it over the local network. If using Tailscale, use the Tailscale IP.'
      }
    ]
  },
  {
    id: 'music-tips',
    icon: FolderOpen,
    title: 'Music Library Tips',
    content: [
      {
        heading: 'Folder Structure',
        text: 'Organize your music into genre folders: Hip-Hop/, Pop/, Rock/, R&B/, etc. Each folder name becomes a selectable genre in the Options tab. You can have subfolders within genres too.'
      },
      {
        heading: 'FEATURE Folder',
        text: 'The FEATURE folder is special — songs in it play to full length without the 3-minute auto-advance. Use this for guest performers, live mixes, or any track that shouldn\'t be cut short.'
      },
      {
        heading: 'Supported Formats',
        text: 'The system supports standard audio formats: MP3, M4A, WAV, OGG, FLAC, AAC, WMA, and WEBM.'
      },
      {
        heading: 'Song Duration Cap',
        text: 'Normal songs are capped at about 3 minutes to keep the rotation moving. The system crossfades to the next track automatically. FEATURE folder songs are the exception — they play in full.'
      },
      {
        heading: 'Break Music',
        text: 'Break songs play between dancer sets to keep music flowing during transitions. Set the number of breaks (0-3) in the Rotation tab. When you hit "Save All," empty break slots auto-fill with shuffled songs from the active genre. Songs already assigned to dancers or other break slots won\'t repeat.'
      },
      {
        heading: 'Song Cooldown',
        text: 'The system tracks every song played and enforces a 4-hour cooldown — no song repeats within a 4-hour window. This applies to both dancer sets and break songs, keeping the music fresh all night.'
      }
    ]
  }
];

function Section({ section, isOpen, onToggle }) {
  const Icon = section.icon;
  return (
    <div className="border border-[#1e293b] rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 bg-[#0d0d1f] hover:bg-[#151528] transition-colors text-left"
      >
        <Icon className="w-5 h-5 text-[#00d4ff] flex-shrink-0" />
        <span className="text-white font-semibold flex-1">{section.title}</span>
        {isOpen ? (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronRight className="w-5 h-5 text-gray-400" />
        )}
      </button>
      {isOpen && (
        <div className="px-5 py-4 bg-[#08081a] space-y-4">
          {section.content.map((item, idx) => (
            <div key={idx}>
              <h4 className="text-[#00d4ff] font-medium text-sm mb-1">{item.heading}</h4>
              <p className="text-gray-300 text-sm leading-relaxed">{item.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Help() {
  const [openSections, setOpenSections] = useState(new Set(['getting-started']));

  const toggleSection = (id) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => setOpenSections(new Set(sections.map(s => s.id)));
  const collapseAll = () => setOpenSections(new Set());

  return (
    <div className="fixed inset-0 bg-[#08081a] text-white overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
      <header className="sticky top-0 z-50 bg-[#08081a]/95 backdrop-blur border-b border-[#1e293b] px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to={createPageUrl('DJBooth')}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Booth
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-[#00d4ff]" />
            <span className="text-lg font-bold text-[#00d4ff]">NEON AI DJ</span>
            <span className="text-lg font-bold text-white ml-1">Help</span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <p className="text-gray-400 text-sm">Everything you need to know about running the booth.</p>
          <div className="flex gap-2">
            <button onClick={expandAll} className="text-xs text-[#00d4ff] hover:text-white transition-colors px-2 py-1 rounded border border-[#1e293b] hover:border-[#00d4ff]/40">
              Expand All
            </button>
            <button onClick={collapseAll} className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded border border-[#1e293b] hover:border-gray-400/40">
              Collapse All
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {sections.map(section => (
            <Section
              key={section.id}
              section={section}
              isOpen={openSections.has(section.id)}
              onToggle={() => toggleSection(section.id)}
            />
          ))}
        </div>

        <div className="mt-12 text-center border-t border-[#1e293b] pt-8">
          <p className="text-gray-500 text-xs">NEON AI DJ — Nightclub Entertainment Operations Network</p>
          <p className="text-gray-600 text-xs mt-1">Automated Intelligent Disc Jockey System</p>
        </div>
      </main>
    </div>
  );
}
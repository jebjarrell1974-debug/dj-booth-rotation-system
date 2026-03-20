import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, Music2, Users, Layers, Mic, SlidersHorizontal, Settings, Radio, Monitor, Smartphone, FolderOpen, Zap, Shield, HelpCircle, Lock } from 'lucide-react';
import { createPageUrl } from '@/utils';

const sections = [
  {
    id: 'getting-started',
    icon: Zap,
    title: 'Getting Started',
    content: [
      {
        heading: 'Three Login Roles',
        text: 'The system has three roles: DJ (full booth control), Entertainer (playlist management only), and Manager access through the Configuration page. From the main screen, tap "DJ Booth" and enter your DJ PIN to run the show. Entertainers tap "Entertainer" and enter their personal PIN to manage their own playlists from any device. The Configuration page uses a separate Master PIN to protect system settings.'
      },
      {
        heading: 'First-Time Setup Checklist',
        text: '1. Log in as DJ. 2. Tap the gear icon (Settings) in the top-right and enter your ElevenLabs API key and OpenAI API key — these power AI voice announcements. 3. Tap the slider icon (Configuration) and enter your Master PIN. Set your club name, open and close hours, and the path to your music folder. 4. Tap "Rescan Music" to load your library. 5. Go to the Entertainers tab and add your performers. 6. Go to the Rotation tab, add entertainers to tonight\'s lineup, set break song counts, and press "Save All." 7. Press "Start Rotation" and you\'re live.'
      },
      {
        heading: 'Daily Opening Routine',
        text: 'Each night: log in as DJ, check that the rotation order is correct for tonight\'s entertainers, update Club Specials in the Announcements tab with any current drink deals or promos, verify the energy level is set to "Auto," and press "Start Rotation." The system handles music playback, announcements, and transitions automatically from there.'
      },
      {
        heading: 'If the System Was Off',
        text: 'The system remembers your rotation, playlists, and all settings between sessions. When you start it back up and log in, everything is right where you left it. You may want to review tonight\'s rotation order and update Club Specials before starting.'
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
        text: 'Choose between "Entertainer First" or "Random." Entertainer First plays from each entertainer\'s personal playlist first, then fills remaining songs with random tracks from the library. Random ignores personal playlists and picks from the full library. Entertainer First is the default and what most venues use — it respects each performer\'s music preferences.'
      },
      {
        heading: 'Active Genres',
        text: 'Your music library is organized by folder — each top-level subfolder becomes a genre. Toggle genres on or off to control which folders the system pulls from. For example, turn off "Country" and keep "Hip-Hop" and "R&B" active for a particular night. The system only plays from active genres when filling auto-picks and break songs.'
      },
      {
        heading: 'Songs Per Set',
        text: 'Controls how many songs each entertainer performs per rotation turn. When the set count is reached, the system automatically crossfades into the next entertainer\'s music and triggers the transition announcement.'
      },
    ]
  },
  {
    id: 'rotation-tab',
    icon: Layers,
    title: 'Rotation Tab',
    content: [
      {
        heading: 'Building Tonight\'s Lineup',
        text: 'The rotation is the ordered list of who goes on stage and when. At the bottom of the tab you\'ll see all active entertainers — tap one to add them to the rotation. Drag the cards to reorder them. The system loops the rotation continuously until you stop it, so every entertainer in the list will cycle through repeatedly throughout the night.'
      },
      {
        heading: 'Song Assignments',
        text: 'Each entertainer\'s card shows the songs assigned to their set. If the entertainer has a personal playlist and Music Mode is "Entertainer First," those songs populate automatically. If they don\'t have enough songs on their playlist, the system fills the remaining slots with auto-picked tracks from the active genres. You can also drag songs into specific slots manually.'
      },
      {
        heading: 'Break Songs',
        text: 'Break songs play between each entertainer to keep music flowing during transitions. Use the purple break buttons (0–3) to set how many break songs you want between each performer. When you press "Save All," any empty break slots are automatically filled with random tracks from the active genres. You can also drag specific songs into break slots if you want to hand-pick them. Songs that are already assigned to an entertainer or another break slot won\'t be duplicated.'
      },
      {
        heading: 'Save All',
        text: 'Press "Save All" after making any changes to the rotation — order, song assignments, or break songs. This saves everything at once, auto-fills empty break slots, and pre-generates voice announcements for upcoming entertainers so they\'re ready to play instantly. Get in the habit of pressing Save All before you start the rotation each night.'
      },
      {
        heading: 'Starting the Rotation',
        text: 'Hit "Start Rotation" in the header. The system begins with the first entertainer in the list — their music starts, they\'re announced, and the timer counts down. When their set ends, the system crossfades into break music, then announces and starts the next entertainer automatically. You don\'t need to do anything between sets.'
      },
      {
        heading: 'Skipping an Entertainer',
        text: 'Tap the skip button (next track icon) on an entertainer\'s card to jump to the next person immediately. Use this if an entertainer isn\'t on stage when their turn comes up or needs to be skipped for any reason.'
      },
      {
        heading: 'Removing from the Rotation',
        text: 'Tap the X on an entertainer\'s card to remove them from tonight\'s lineup. This does not delete them from the system — they\'re still in your Entertainers list and can be added back anytime.'
      }
    ]
  },
  {
    id: 'dancers-tab',
    icon: Users,
    title: 'Entertainers Tab',
    content: [
      {
        heading: 'Adding a New Entertainer',
        text: 'Tap "Add" and enter their stage name. Each entertainer gets a unique color for easy identification on the rotation. You can also set an optional personal PIN at this point — they\'ll need it to log in on their own device and manage their playlist themselves.'
      },
      {
        heading: 'Active vs. Inactive',
        text: 'Toggle an entertainer as active or inactive. Inactive entertainers stay in the system but won\'t appear when building the rotation. Use this for entertainers who only work certain nights — toggle them active on nights they\'re working, inactive on nights they\'re off. Their playlist and settings are always preserved.'
      },
      {
        heading: 'Entertainer Sets Up Their Own Playlist (From Their Phone)',
        text: 'This is the recommended approach. Give the entertainer the app URL and their personal PIN. On their phone, they tap "Entertainer" on the main screen and log in with their PIN. They\'ll land in their personal playlist view. From there, they can search the music library by song name or artist, add songs to their list, drag to reorder them, and remove songs they don\'t want. Any changes they save sync to the booth automatically — the next time their turn comes up in rotation, the updated playlist is used. Entertainers can do this before the night starts or even between their sets.'
      },
      {
        heading: 'DJ or Manager Helps Set Up a Playlist',
        text: 'If an entertainer doesn\'t have their phone or prefers help, you can manage their playlist directly from the DJ Booth. In the Entertainers tab, tap the music note icon on their card to open their playlist editor. The music library appears — search for songs and tap to add them to their list. You can drag to reorder and tap to remove. Press "Save" when done. The changes take effect immediately for that entertainer\'s next set.'
      },
      {
        heading: 'How Many Songs to Add',
        text: 'A good target is at least as many songs as their set size (set in Options tab) plus a few extras so the system has variety. For a 3-song set, aim for 5–8 songs in their playlist. If an entertainer has fewer songs than their set size, the system automatically fills the remaining slots with auto-picks from the library — so a playlist with even 1 or 2 songs will still work fine.'
      },
      {
        heading: 'If an Announcement Sounds Wrong (Intro, Outro, Round 2, Round 3)',
        text: 'Each entertainer has up to four announcement types: an intro (when they first take the stage), a mid-set call (during round 2 or 3, while they\'re still on stage), an outro (when they finish), and a transition (bridging into the next entertainer). If any of these sounds off — mispronounces the name, sounds robotic, or just doesn\'t land right — here\'s how to reset it:\n\n1. Go to the Entertainers tab.\n2. Find that entertainer\'s card.\n3. Tap "Reset Voiceover."\n4. Confirm the reset — this wipes all of their cached announcements from the server, database, and browser cache at once.\n5. Fresh announcements will be generated automatically the next time their set comes up in the rotation.\n\nNote: the reset clears all announcement types for that entertainer together — you can\'t reset just the intro or just the outro individually. If the name pronunciation is the root issue, the same steps apply — the new announcement will use the latest pronunciation settings.'
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
        text: 'The system scans the music folder you set in Configuration. Each subfolder inside that folder becomes a genre. For example, if your music folder contains "Hip-Hop," "Pop," and "R&B" subfolders, those three become selectable genres in the Options tab. You can have as many genre folders as you want.'
      },
      {
        heading: 'The FEATURE Folder',
        text: 'Create a folder named exactly "FEATURE" inside your music directory for special performers. Songs in the FEATURE folder play to their full length — up to 60 minutes — instead of the normal 3-minute cap. Use this for guest DJs, live performers, or any set that shouldn\'t be cut short. Normal rotation rules still apply for everything else.'
      },
      {
        heading: 'Browsing and Playing',
        text: 'Browse by genre folder or search by song name or artist. Tap any track to play it immediately. This is useful for DJ-ing manually, testing a track, or playing a specific song on request.'
      },
      {
        heading: 'Adding New Music',
        text: 'Add new audio files to the music folder on the device. The system rescans automatically on startup, or you can trigger an immediate rescan from the Configuration page without restarting.'
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
        text: 'The system uses AI to write and speak DJ-style announcements at the right moments: an intro when an entertainer takes the stage, a mid-set call during their second song, an outro when they finish, and a transition into the next performer. The voice is generated by ElevenLabs — the same voice every time, consistent and professional.'
      },
      {
        heading: 'What the Announcements Sound Like',
        text: 'Intros say the entertainer\'s name 2–3 times, varied naturally so it doesn\'t sound robotic. Mid-set calls acknowledge the entertainer is still on stage and keep energy up. Outros are short sendoffs. Transitions bridge from one entertainer to the next. All of it adjusts in tone and energy based on the time of night and your energy level setting.'
      },
      {
        heading: 'Club Specials',
        text: 'Enter current specials — drink deals, VIP promos, last call — in the Club Specials field on the Announcements tab. The AI weaves these naturally into outros and transition announcements throughout the night. Update this whenever your specials change.'
      },
      {
        heading: 'Manual Announcements',
        text: 'Type any custom message and tap the send button to have it spoken immediately in the DJ voice. Use this for shout-outs, birthday calls, table announcements, or anything off-script. The music ducks automatically while the announcement plays, then comes back up.'
      },
      {
        heading: 'Voice Volume (Gain)',
        text: 'Announcements have their own volume separate from music. The purple mic icon with +/– buttons adjusts voice gain from 50% to 300%. Default is 150% so the voice cuts through ambient noise. This setting saves automatically and syncs to the remote.'
      },
      {
        heading: 'Pre-Generating Voiceovers',
        text: 'When you press "Save All" in the Rotation tab, the system pre-generates voice announcements for all upcoming entertainers in the background. This means announcements play instantly with no delay when it\'s their turn. If you add a new entertainer to the rotation mid-night, their announcement may take a moment to generate the first time.'
      },
      {
        heading: 'What Happens if AI Keys Are Missing',
        text: 'The system shows a warning banner if ElevenLabs or OpenAI keys are not set. Rotation and music playback continue normally — only the voice announcements are skipped until the keys are entered in Settings.'
      }
    ]
  },
  {
    id: 'settings',
    icon: Settings,
    title: 'Settings (Gear Icon)',
    content: [
      {
        heading: 'Where to Find It',
        text: 'Tap the gear icon in the top-right corner of the DJ Booth. This is separate from Configuration — Settings stores API keys for AI services, while Configuration handles club info, music paths, and system PINs.'
      },
      {
        heading: 'ElevenLabs API Key',
        text: 'Required for voice announcements. Log in to elevenlabs.io, go to your profile, copy your API key, and paste it here. The key is saved locally on the device — you only need to enter it once.'
      },
      {
        heading: 'OpenAI API Key',
        text: 'Required for generating announcement scripts. Log in to platform.openai.com, create an API key, and paste it here. If you prefer not to use OpenAI, the Configuration page has a "Script Model" setting with a built-in alternative that doesn\'t require a key.'
      },
      {
        heading: 'ElevenLabs Voice ID',
        text: 'If you have a custom cloned voice in ElevenLabs, paste its Voice ID here to use it for all announcements. Leave blank to use the default voice.'
      },
      {
        heading: 'Auto-Save',
        text: 'All settings save automatically as you type. There is no save button — just enter or paste your values and they\'re stored immediately.'
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
        text: 'Tap the slider icon in the top-right of the DJ Booth header. You\'ll be prompted for the Master PIN (different from the DJ PIN). The Master PIN protects system-level settings. If you don\'t know it, ask whoever set up the system.'
      },
      {
        heading: 'Club Name and Hours',
        text: 'Set your club name, open hour, and close hour. The AI uses these for time-aware announcements — it knows whether it\'s early in the night or peak hours and adjusts energy accordingly. Get these right on first setup and you rarely need to change them.'
      },
      {
        heading: 'Music Path',
        text: 'Set the full folder path to where your music files live on the device. On a Raspberry Pi this is typically something like "/home/pi/Music" or "/home/user/Music." Once set, the system scans this folder and all subfolders automatically. Tap "Rescan Music" any time you add new files.'
      },
      {
        heading: 'Changing PINs',
        text: 'Change the DJ PIN (what the DJ enters to log in) and the Master PIN (what\'s needed for Configuration) from this page. Keep the Master PIN private — share the DJ PIN with your DJs. Each entertainer has their own individual PIN set from the Entertainers tab.'
      },
      {
        heading: 'Script Model',
        text: 'Choose which AI generates announcement scripts. "Auto" uses the built-in model and requires no OpenAI key. Other options use OpenAI models directly for potentially more varied scripts. Start with Auto and switch if you want to experiment.'
      },
      {
        heading: 'Voiceover Cache Management',
        text: 'The "Clear All Voiceovers" option wipes all pre-generated announcements and forces fresh ones to be created. Use this if you\'ve changed your voice settings and want everything regenerated, or if announcements sound stale.'
      }
    ]
  },
  {
    id: 'rotation-display',
    icon: Radio,
    title: 'Rotation Display (HDMI Screen)',
    content: [
      {
        heading: 'What It Is',
        text: 'A full-screen display showing the current rotation lineup — who\'s on now, who\'s up next, and the full order for the night. It\'s designed to show on a separate monitor or TV (connected via HDMI) so entertainers and staff can see the lineup without interrupting the DJ.'
      },
      {
        heading: 'Opening It',
        text: 'Tap "Open Display" in the DJ Booth header. This opens the rotation display in a new browser tab or window. Move that window to your second screen and put it in fullscreen mode (F11 on most keyboards, or the browser\'s fullscreen option). It will stay there independently.'
      },
      {
        heading: 'Auto-Updates',
        text: 'The display refreshes automatically every few seconds. As the DJ advances through the rotation, the display updates in real time — no manual refresh needed. The current performer is highlighted so it\'s easy to read at a glance from across the room.'
      },
      {
        heading: 'Auto-Lock Does Not Apply Here',
        text: 'The inactivity auto-lock only affects the DJ Booth and the remote. The rotation display screen never locks — it stays visible on the HDMI screen all night without any timeouts.'
      }
    ]
  },
  {
    id: 'dancer-view',
    icon: Smartphone,
    title: 'Entertainer View (Their Phone)',
    content: [
      {
        heading: 'What It Is',
        text: 'A separate mobile-friendly interface for entertainers to build and manage their personal song playlist. They access it from any phone or tablet using the same app URL as the DJ booth — they just log in with their own PIN instead of the DJ PIN.'
      },
      {
        heading: 'How an Entertainer Logs In',
        text: 'On the main screen, the entertainer taps "Entertainer," enters their personal PIN, and they\'re taken directly to their playlist view. They never see the DJ booth controls — their view is limited to their own playlist management.'
      },
      {
        heading: 'Setting Up Their Playlist',
        text: 'Inside the entertainer view, they\'ll see a search bar and their current playlist. They search for songs by name or artist, tap a result to add it, and it appears in their playlist. They can drag songs to reorder them (their preferred order is used when building their set) and tap the trash icon to remove songs they don\'t want.'
      },
      {
        heading: 'When Changes Take Effect',
        text: 'Updates sync to the booth automatically. Changes made before the rotation starts are ready immediately. Changes made mid-night take effect the next time that entertainer\'s set is built — typically when the rotation cycles back to them.'
      },
      {
        heading: 'Connecting to the Right Booth',
        text: 'If the entertainer is on a separate device (phone) outside the same Wi-Fi as the booth, they\'ll need to enter the booth\'s IP address on the login screen. Tap "Set Booth IP" and enter the IP of the Raspberry Pi running the booth. Once set, it\'s remembered on that device.'
      },
      {
        heading: 'Auto-Logout',
        text: 'The entertainer view automatically logs out after 4 hours of inactivity to keep the device secure. This does not affect the DJ booth — they are completely separate sessions.'
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
        text: 'Any second device — iPad, phone, or laptop — can be used as a remote control for the DJ booth. On the secondary device, go to the app URL, tap "DJ Booth," select "DJ Remote" mode, and log in with the DJ PIN. The device connects to the main booth over the network and gives you live control.'
      },
      {
        heading: 'What You Can Do from the Remote',
        text: 'Skip to the next entertainer. Adjust music volume up or down. Adjust voice announcement volume up or down. Toggle announcements on or off. See the current song playing with a live countdown timer. These controls are instant — they go through to the booth in real time.'
      },
      {
        heading: 'Setting the Booth IP',
        text: 'On the login screen of the remote device, tap "Set Booth IP" and enter the IP address of the main booth Raspberry Pi. This tells the remote device where to find the booth on the network. Once entered, it\'s saved on that device and you won\'t need to re-enter it unless the booth\'s IP changes. If your venue uses Tailscale, enter the Tailscale IP.'
      },
      {
        heading: 'Auto-Lock on the Remote',
        text: 'The remote auto-locks after 3 minutes of inactivity — same as the DJ kiosk. A 30-second countdown warning appears before it locks. Tap anywhere on screen to reset the timer and stay logged in. This keeps the iPad secure if it\'s set down and walked away from.'
      },
      {
        heading: 'Remote Does Not Play Audio',
        text: 'The remote controls the booth but doesn\'t play audio itself. All music and announcements come from the main booth device. The remote is purely a control surface.'
      }
    ]
  },
  {
    id: 'auto-lock',
    icon: Lock,
    title: 'Auto-Lock & Security',
    content: [
      {
        heading: 'What Auto-Lock Does',
        text: 'If the DJ booth or remote iPad is left untouched for 3 minutes, the screen automatically logs out and returns to the main landing page. This prevents anyone from walking up to an unattended booth and making changes.'
      },
      {
        heading: 'The Countdown Warning',
        text: 'At 2 minutes 30 seconds of inactivity, a countdown overlay appears over the screen with a large timer counting down from 30 seconds. Tap anywhere on the screen — or tap "Stay Logged In" — to immediately reset the timer and dismiss the overlay. The circle turns red in the final 10 seconds as an additional warning.'
      },
      {
        heading: 'Music Keeps Playing',
        text: 'Auto-lock only locks the screen. The music, announcements, and rotation all continue running normally in the background. Locking the screen does not interrupt the show in any way.'
      },
      {
        heading: 'What Counts as Activity',
        text: 'Any tap or click anywhere on screen resets the inactivity timer. Normal use — changing songs, skipping entertainers, adjusting volume — all count as activity and will never accidentally trigger the lock during regular operation.'
      },
      {
        heading: 'Rotation Display Is Exempt',
        text: 'The auto-lock does not apply to the rotation display screen (the HDMI output). That screen is meant to stay visible all night without any interaction, so it never times out.'
      },
      {
        heading: 'Logging Back In',
        text: 'After auto-lock, the DJ PIN login screen appears. Enter the DJ PIN to get back in. The rotation state, song position, and everything else is exactly as it was before the lock.'
      }
    ]
  },
  {
    id: 'music-tips',
    icon: FolderOpen,
    title: 'Music Library Tips',
    content: [
      {
        heading: 'Recommended Folder Structure',
        text: 'Organize music into clearly named genre folders inside your main music directory: Hip-Hop/, R&B/, Pop/, Top-40/, Latin/, etc. Each folder name becomes a genre toggle in the Options tab. Keep names short and clear — they show up directly in the UI.'
      },
      {
        heading: 'The FEATURE Folder',
        text: 'The FEATURE folder is special — songs in it play to full length without the 3-minute auto-advance. Use it for guest performers, live sets, or extended mixes. Name the folder exactly "FEATURE" (all caps).'
      },
      {
        heading: 'Supported File Formats',
        text: 'The system supports MP3, M4A, WAV, OGG, FLAC, AAC, WMA, and WEBM. MP3 and M4A are the most reliable and recommended formats for best compatibility.'
      },
      {
        heading: 'Song Duration Cap',
        text: 'Normal songs are capped at approximately 3 minutes to keep the rotation moving and transition smoothly. The system crossfades to the next track automatically at that point. Songs in the FEATURE folder are the exception and play to full length.'
      },
      {
        heading: 'Song Cooldown',
        text: 'The system tracks every song played and enforces a 6-hour cooldown — no song repeats within a 6-hour window. This applies across entertainer sets and break songs alike, keeping the music fresh throughout even a long night.'
      },
      {
        heading: 'Break Song Auto-Fill',
        text: 'When you press "Save All," any empty break slots are filled automatically using songs from the active genres. The system avoids repeating songs already assigned to entertainers or other break slots in the same rotation. You can also drag specific songs into break slots to override the auto-fill — great if you have a go-to track you always want between sets.'
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
              <p className="text-gray-300 text-sm leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>{item.text}</p>
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
          <p className="text-gray-400 text-sm">Everything you need to run the booth.</p>
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

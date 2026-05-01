/**
 * DiscordBlock — renders one <external to="discord:…"> block styled to
 * approximate how the message will appear in Discord.
 *
 * Not a pixel-perfect Discord clone — the goal is "at a glance the
 * operator knows this part goes to Discord and sees roughly what their
 * user will see." Markdown is rendered through ReactMarkdown so code
 * blocks, lists, etc. look right.
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import ExternalCard from './ExternalCard.jsx';

// Discord's brand-adjacent blurple
const DISCORD_ACCENT = 'bg-[#5865F2]';

function DiscordIcon() {
  return (
    <svg className="w-4 h-4 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369A19.791 19.791 0 0 0 16.558 3a13.5 13.5 0 0 0-.617 1.264 18.2 18.2 0 0 0-5.48 0A13 13 0 0 0 9.837 3a19.74 19.74 0 0 0-3.762 1.369C2.42 9.87 1.467 15.225 1.944 20.5a19.87 19.87 0 0 0 6.034 3.053c.486-.666.92-1.374 1.293-2.12a13 13 0 0 1-2.036-.974c.171-.126.338-.257.499-.392a14.22 14.22 0 0 0 12.53 0c.163.135.33.266.5.392a13 13 0 0 1-2.04.976 14 14 0 0 0 1.294 2.12 19.85 19.85 0 0 0 6.035-3.054c.562-6.11-.96-11.415-4.036-16.132ZM8.678 16.25c-1.183 0-2.156-1.085-2.156-2.419 0-1.333.944-2.42 2.156-2.42 1.212 0 2.179 1.087 2.156 2.42 0 1.334-.952 2.42-2.156 2.42Zm7.975 0c-1.182 0-2.156-1.085-2.156-2.419 0-1.333.944-2.42 2.156-2.42 1.213 0 2.178 1.087 2.156 2.42 0 1.334-.944 2.42-2.156 2.42Z"/>
    </svg>
  );
}

function DiscordBlock({ label, text, streaming = false }) {
  return (
    <ExternalCard
      icon={<DiscordIcon />}
      accentClass={DISCORD_ACCENT}
      bodyClass="bg-[#36393F] text-[#DCDDDE] [&_code]:bg-[#2F3136] [&_code]:text-[#E8E8E8] [&_pre]:bg-[#2F3136] [&_a]:text-[#00AFF4]"
      label={label}
      streaming={streaming}
    >
      {text
        ? <div className="prose prose-sm prose-invert max-w-none"><ReactMarkdown>{text}</ReactMarkdown></div>
        : <div className="italic text-gray-400">…</div>
      }
    </ExternalCard>
  );
}

export default DiscordBlock;

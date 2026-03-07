import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const socials = [
  {
    name: 'TikTok',
    url: 'https://www.tiktok.com/@ceoramz?_r=1&_t=ZS-94SPdGqZ8dR',
    hoverClass: 'hover:text-foreground hover:drop-shadow-[0_0_6px_hsl(var(--foreground)/0.4)]',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.18 8.18 0 004.76 1.52V6.84a4.84 4.84 0 01-1-.15z" />
      </svg>
    ),
  },
  {
    name: 'YouTube',
    url: 'https://www.youtube.com/@ceoramz',
    hoverClass: 'hover:text-[hsl(0,100%,50%)] hover:drop-shadow-[0_0_6px_hsl(0,100%,50%,0.4)]',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M23.5 6.19a3.02 3.02 0 00-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 00.5 6.19 31.64 31.64 0 000 12a31.64 31.64 0 00.5 5.81 3.02 3.02 0 002.12 2.14c1.84.55 9.38.55 9.38.55s7.54 0 9.38-.55a3.02 3.02 0 002.12-2.14A31.64 31.64 0 0024 12a31.64 31.64 0 00-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z" />
      </svg>
    ),
  },
  {
    name: 'Telegram',
    url: 'https://t.me/+YDUwvuuVDYg5NjE0',
    hoverClass: 'hover:text-[hsl(200,80%,55%)] hover:drop-shadow-[0_0_6px_hsl(200,80%,55%,0.4)]',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M11.94 24c6.6 0 11.94-5.37 11.94-12S18.54 0 11.94 0 0 5.37 0 12s5.34 12 11.94 12zm-3.15-8.27l-.36-3.2 8.4-7.59c.37-.34-.08-.5-.57-.2l-10.39 6.56-4.48-1.4c-.97-.3-.99-.97.2-1.44l17.53-6.76c.8-.37 1.55.2 1.25 1.44l-2.99 14.08c-.2.97-.8 1.2-1.62.75l-4.48-3.31-2.16 2.08c-.24.24-.44.44-.84.44z" />
      </svg>
    ),
  },
  {
    name: 'Instagram',
    url: 'https://www.instagram.com/ramztrader.site?igsh=aDY1aGFiMGpobHJi',
    hoverClass: 'hover:text-[hsl(330,70%,55%)] hover:drop-shadow-[0_0_6px_hsl(330,70%,55%,0.4)]',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.97.24 2.44.41.61.24 1.05.52 1.51.98.46.46.74.9.98 1.51.17.47.36 1.27.41 2.44.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.24 1.97-.41 2.44-.24.61-.52 1.05-.98 1.51a4.07 4.07 0 01-1.51.98c-.47.17-1.27.36-2.44.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.97-.24-2.44-.41a4.07 4.07 0 01-1.51-.98 4.07 4.07 0 01-.98-1.51c-.17-.47-.36-1.27-.41-2.44C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.24-1.97.41-2.44.24-.61.52-1.05.98-1.51a4.07 4.07 0 011.51-.98c.47-.17 1.27-.36 2.44-.41C8.84 2.17 9.22 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.96 5.96 0 00-2.16 1.35A5.96 5.96 0 00.63 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.79.72 1.46 1.35 2.16a5.96 5.96 0 002.16 1.35c.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.96 5.96 0 002.16-1.35 5.96 5.96 0 001.35-2.16c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.96 5.96 0 00-1.35-2.16A5.96 5.96 0 0019.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 100 12.32 6.16 6.16 0 000-12.32zM12 16a4 4 0 110-8 4 4 0 010 8zm7.85-10.4a1.44 1.44 0 11-2.88 0 1.44 1.44 0 012.88 0z" />
      </svg>
    ),
  },
];

export default function SocialIcons() {
  return (
    <div className="flex items-center gap-1">
      {socials.map(s => (
        <Tooltip key={s.name}>
          <TooltipTrigger asChild>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`p-1.5 rounded-md text-muted-foreground transition-all duration-200 ${s.hoverClass}`}
            >
              {s.icon}
            </a>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">{s.name}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

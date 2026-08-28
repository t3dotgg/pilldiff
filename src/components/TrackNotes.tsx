import { ChevronDown, ExternalLink, MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import type { Track } from '../../shared/types';

interface TrackNotesProps {
  track: Track;
  sourceUrl?: string;
  initiallyOpen?: boolean;
}

export function TrackNotes({ track, sourceUrl, initiallyOpen = false }: TrackNotesProps) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  if (!track.description) return null;

  return (
    <details className="track-notes" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary aria-label={`Bill's notes on ${track.label || track.title}`}>
        <MessageSquareText size={13} aria-hidden="true" />
        <span>Bill’s notes</span>
        <ChevronDown className="notes-chevron" size={13} aria-hidden="true" />
      </summary>
      <div className="notes-prose">
        {track.description.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">Read on the blog <ExternalLink size={12} /></a> : null}
      </div>
    </details>
  );
}

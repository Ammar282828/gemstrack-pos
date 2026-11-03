'use client';

import { SegmentError } from '@/components/shared/segment-error';

// A page in this section threw: the section's own screen (sidebar and tabs stay), see components/shared/segment-error.tsx.
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} section="Insights" href="/insights" />;
}

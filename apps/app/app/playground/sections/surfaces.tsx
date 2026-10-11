/**
 * Surfaces: the two graph paper recipes in `app/app.css`, on empty boxes.
 *
 * `.surface-brand` is the hero panel (a fading cover over the paper, so the
 * top shows the grid and the lower part is the card fill). `.surface-grid` is
 * the landing page's backdrop (paper at a flat strength). The boxes are empty
 * on purpose: the point is how the paper meets the edge and how the fade
 * behaves at three heights. Switch the theme in the rail to see both modes.
 */
import type { ReactElement } from 'react';

import { Card as AppCard } from '#app/components/ui/card';
import { cn } from '#app/lib/utils';
import { Card, Group, Section, type SectionDef } from '../layout';

export const DEF: SectionDef = {
  id: 'surfaces',
  title: 'Surfaces',
  intent:
    'The .surface-brand and .surface-grid recipes on empty boxes of a few heights. Use the theme control for light and dark.',
};

const BOX_HEIGHTS = [
  { height: 'h-24', handle: 'short', label: 'Short (96 px)' },
  { height: 'h-52', handle: 'medium', label: 'Medium (208 px)' },
  { height: 'h-80', handle: 'tall', label: 'Tall (320 px)' },
] as const;

export default function SurfacesSection(): ReactElement {
  return (
    <Section def={DEF}>
      <Group title="Surface brand">
        {BOX_HEIGHTS.map((box) => (
          <Card
            key={box.handle}
            state={`surface-brand-${box.handle}`}
            label={`surface-brand, ${box.label}`}
            reach="Open Today (/dashboard): the Today so far hero wears it, as a Card with overflow hidden and shadow-sm."
          >
            <AppCard className={cn('surface-brand overflow-hidden shadow-sm', box.height)} />
          </Card>
        ))}
      </Group>
      <Group title="Surface grid">
        {BOX_HEIGHTS.map((box) => (
          <Card
            key={box.handle}
            state={`surface-grid-${box.handle}`}
            label={`surface-grid, ${box.label}`}
            reach="Open the landing page while signed out (/): its hero section wears it as a full width backdrop."
          >
            <div className={cn('surface-grid border', box.height)} />
          </Card>
        ))}
      </Group>
    </Section>
  );
}

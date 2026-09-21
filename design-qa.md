# FPAI Economy UX design QA

Reference: production Economy screenshot from September 20, 2026.

## Desktop

- Filmmaker task appears before engineering controls.
- Shot, audio result, recommended route, duration, resolution, estimate, and spend cap are visible together.
- Dialogue, sound-only, and silent modes update the recommendation and quote.
- Review opens the existing shot package without submitting a paid request.
- Advanced production controls expand and retain the existing routing and learning tools.
- No horizontal overflow or console errors at 1440 × 1100.

## Mobile

- The shot builder is the first working surface after the production header.
- Controls stack into one readable column at 390 × 844.
- The bottom navigation has visible labels and accessible names.
- No horizontal overflow or console errors.

## Safety

- Paid execution remains disabled in the interface.
- Production deployment flags keep Veo, LTX, and Seedance execution closed.

Final result: passed

## Overview dashboard redesign

- Desktop, 1440 x 1000: passed. Production command hero, next action, readiness pulse, active scene, hero shot, and economy rail are visible without horizontal overflow.
- Mobile, 390 x 844: passed. Hero and action cards stack cleanly, controls remain touch-sized, navigation labels remain visible, and the page has no horizontal overflow.
- Primary actions: passed. Dashboard navigation routes into Film Engine, Shots, Characters, Economy, Scenes, and Budget through the existing application state.
- Browser console: passed with no errors during desktop and mobile rendering.
- Spend safety: passed. The dashboard states that paid rendering is off, and repository production flags remain disabled.

Final result: passed

# Pixel interview room · v0.2.0

The user requested a working room-and-dialogue interface based on their supplied reference, not an evaluation dashboard or a flattened UI image.

- Warm pixel-art room on the left; selected interviewer, question bubble and answer field on the right. The room includes exactly three interviewers and one candidate.
- Pixel treatment is applied to room artwork, frames and portraits. Korean reading text uses the existing system font, with no third-party font dependency.
- The selected role is named in the room, portrait control and bubble. Buttons remain keyboard accessible and provide pressed state. Room hit areas use 17% widths to avoid overlapping adjacent role targets.
- First the user reads the question, loads a fictional answer, then explicitly opens recorded feedback. Scores are not created or displayed as a reward for typing. Real API mode retains explicit consent and cost gating.
- Existing recorded Work results, rubric, server-side key handling and isolated role requests remain unchanged. This is a visual and flow revision, not new evidence of live API success.
- On narrow screens the room and console stack. Temporary viewport overrides are for responsive validation and must be reset.
- The reference image is not shipped. The generated room artwork is a separate project asset. Portraits are CSS views into that same asset; all speech text and controls are live HTML.

Generation route: built-in image_gen. Full prompt: interview-room-art-prompt.md. API/CLI image generation was not used.

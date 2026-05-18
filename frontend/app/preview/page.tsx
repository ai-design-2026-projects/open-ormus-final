import { PreviewNav } from "./_components/preview-nav"
import { Section } from "./_components/section"
import { ColorSection } from "./_components/color-section"
import { TypographySection } from "./_components/typography-section"
import { SpacingSection } from "./_components/spacing-section"
import { ElevationSection } from "./_components/elevation-section"
import { MotionSection } from "./_components/motion-section"
import { ButtonsSection } from "./_components/buttons-section"
import { InputsSection } from "./_components/inputs-section"
import { BadgesSection } from "./_components/badges-section"
import { MonogramShowcase } from "./_components/monogram-showcase"
import { CharacterCardDemo } from "./_components/character-card-demo"
import { ScreenplayDemo } from "./_components/screenplay-block"
import { SheetFieldDemo } from "./_components/sheet-field"
import { CastStateDemo } from "./_components/cast-state"
import { EmotionDotsDemo } from "./_components/emotion-dots"
import { SessionRowDemo } from "./_components/session-row"
import { AppNavDemo } from "./_components/app-nav-demo"

export const metadata = { title: "Design System · OpenOrmus" }

export default function PreviewPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-8 py-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="t-meta mb-3">DESIGN SYSTEM · PREVIEW</div>
          <h1 className="t-h1">Open<em className="t-editorial">Ormus</em></h1>
          <p className="t-body-l text-ink-mute mt-3 max-w-xl">
            Synth-glass on warm light · Geist + Geist Mono + Instrument Serif
          </p>
        </div>
      </header>
      <div className="max-w-[1280px] mx-auto px-8 py-12 flex gap-12">
        <PreviewNav />
        <main className="flex-1 flex flex-col gap-16 min-w-0">
          <Section id="colors" kicker="01 · Colors"><ColorSection /></Section>
          <Section id="typography" kicker="02 · Typography"><TypographySection /></Section>
          <Section id="spacing" kicker="03 · Spacing & Radii"><SpacingSection /></Section>
          <div className="hair-prism" />
          <Section id="elevation" kicker="04 · Elevation"><ElevationSection /></Section>
          <Section id="motion" kicker="05 · Motion"><MotionSection /></Section>
          <div className="hair-prism" />
          <Section id="buttons" kicker="06 · Buttons"><ButtonsSection /></Section>
          <Section id="inputs" kicker="07 · Inputs"><InputsSection /></Section>
          <Section id="badges" kicker="08 · Badges & Tags"><BadgesSection /></Section>
          <Section id="monograms" kicker="09 · Monograms"><MonogramShowcase /></Section>
          <div className="hair-prism" />
          <Section id="character-card" kicker="10 · Character card"><CharacterCardDemo /></Section>
          <Section id="screenplay" kicker="11 · Screenplay"><ScreenplayDemo /></Section>
          <Section id="sheet-field" kicker="12 · Sheet field"><SheetFieldDemo /></Section>
          <Section id="cast-state" kicker="13 · Cast state"><CastStateDemo /></Section>
          <Section id="emotion-dots" kicker="14 · Emotion dots"><EmotionDotsDemo /></Section>
          <Section id="session-row" kicker="15 · Session row"><SessionRowDemo /></Section>
          <Section id="app-nav" kicker="16 · App nav"><AppNavDemo /></Section>
        </main>
      </div>
    </div>
  )
}

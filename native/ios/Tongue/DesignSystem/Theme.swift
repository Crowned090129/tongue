import SwiftUI

/// Brand palette for Tongue. A single accent colour, no emoji in the UI
/// (country flags are the only exception, used in the language picker).
///
/// Colours are defined per colour-scheme in code (rather than an asset catalog)
/// so the palette is version-controlled, diff-able, and trivially testable.
/// `Theme` is injected via the environment (`\.theme`) and also exposed as a
/// convenience on `Color` for static use.
struct Theme {
    // Core surfaces
    let accent: Color
    let accentPink: Color
    let background: Color
    let surface: Color
    let surface2: Color
    let stage: Color

    // Text
    let text: Color
    let muted: Color
    let line: Color

    // Semantic
    let green: Color
    let red: Color

    /// 135° brand gradient (pink → accent).
    var brandGradient: LinearGradient {
        LinearGradient(
            colors: [accentPink, Color(hex: 0xC0153E)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    // MARK: Light

    static let light = Theme(
        accent: Color(hex: 0xC0153E),
        accentPink: Color(hex: 0xFF5F7E),
        background: Color(hex: 0xF5F2EC),
        surface: Color(hex: 0xFFFFFF),
        surface2: Color(hex: 0xEDE9E1),
        stage: Color(hex: 0xE5E0D6),
        text: Color(hex: 0x14121A),
        muted: Color(hex: 0x14121A).opacity(0.50),
        line: Color(hex: 0x121016).opacity(0.10),
        green: Color(hex: 0x1E9962),
        red: Color(hex: 0xE5484D)
    )

    // MARK: Dark

    static let dark = Theme(
        accent: Color(hex: 0xFF7090),
        accentPink: Color(hex: 0xFF5F7E),
        background: Color(hex: 0x0E0C14),
        surface: Color(hex: 0x161420),
        surface2: Color(hex: 0x1E1B2A),
        stage: Color(hex: 0x08070D),
        text: Color(hex: 0xEDE9F5),
        muted: Color(hex: 0xEDE9F5).opacity(0.52),
        line: Color.white.opacity(0.07),
        green: Color(hex: 0x1E9962),
        red: Color(hex: 0xE5484D)
    )

    static func resolve(_ scheme: ColorScheme) -> Theme {
        scheme == .dark ? .dark : .light
    }
}

// MARK: - Environment plumbing

private struct ThemeKey: EnvironmentKey {
    static let defaultValue: Theme = .light
}

extension EnvironmentValues {
    var theme: Theme {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

extension View {
    /// Resolves the correct palette for the current colour scheme and injects it.
    /// Attach once near the root of a screen or the app.
    func tongueTheme() -> some View {
        modifier(ThemeInjector())
    }
}

private struct ThemeInjector: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        content.environment(\.theme, Theme.resolve(scheme))
    }
}

// MARK: - Color hex helper

extension Color {
    /// Create a Color from a 24-bit hex integer, e.g. `Color(hex: 0xC0153E)`.
    init(hex: UInt32, alpha: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}

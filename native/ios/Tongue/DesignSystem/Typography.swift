import SwiftUI

/// SF Pro (system font) type scale. Bold weights for display; no bundled fonts.
enum TongueFont {
    static func display(_ size: CGFloat) -> Font {
        .system(size: size, weight: .bold, design: .default)
    }

    /// Large display title.
    static var largeTitle: Font { display(34) }
    static var title: Font { display(28) }
    static var title2: Font { display(22) }
    static var headline: Font { .system(size: 17, weight: .semibold) }
    static var body: Font { .system(size: 17, weight: .regular) }
    static var callout: Font { .system(size: 16, weight: .regular) }
    static var subhead: Font { .system(size: 15, weight: .regular) }
    static var footnote: Font { .system(size: 13, weight: .regular) }
    static var caption: Font { .system(size: 12, weight: .medium) }
}

/// Corner radii from the brand spec.
enum Radius {
    static let card: CGFloat = 16
    static let button: CGFloat = 11
    static let pill: CGFloat = 999
}

/// Consistent spacing scale (multiples of 4).
enum Spacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
}

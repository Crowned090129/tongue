import SwiftUI

/// Recursively renders a `JSONValue` in a readable, hierarchical layout.
///
/// The `/api/content` endpoint returns dynamic, feature-shaped JSON. Rather than
/// hard-code a schema (which would break the moment the backend adds a field),
/// we walk the tree and present objects as labelled sections, arrays as lists,
/// and scalars as text. Keys starting with "_" (metadata) are hidden.
struct JSONContentView: View {
    @Environment(\.theme) private var theme
    let value: JSONValue
    var depth: Int = 0

    var body: some View {
        switch value {
        case .object(let dict):
            VStack(alignment: .leading, spacing: Spacing.md) {
                ForEach(orderedKeys(dict), id: \.self) { key in
                    if !key.hasPrefix("_") {
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(prettify(key))
                                .font(depth == 0 ? TongueFont.headline : TongueFont.subhead)
                                .foregroundStyle(depth == 0 ? theme.text : theme.accent)
                            JSONContentView(value: dict[key] ?? .null, depth: depth + 1)
                        }
                    }
                }
            }

        case .array(let items):
            VStack(alignment: .leading, spacing: Spacing.sm) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        Circle()
                            .fill(theme.accent)
                            .frame(width: 5, height: 5)
                            .padding(.top, 7)
                        JSONContentView(value: item, depth: depth + 1)
                    }
                }
            }

        case .string(let s):
            Text(s)
                .font(TongueFont.callout)
                .foregroundStyle(theme.text)
                .fixedSize(horizontal: false, vertical: true)

        case .number(let n):
            Text(n.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(n)) : String(n))
                .font(TongueFont.callout)
                .foregroundStyle(theme.text)

        case .bool(let b):
            Text(b ? "Yes" : "No")
                .font(TongueFont.callout)
                .foregroundStyle(theme.muted)

        case .null:
            EmptyView()
        }
    }

    /// Keep original insertion-ish order stable and readable.
    private func orderedKeys(_ dict: [String: JSONValue]) -> [String] {
        dict.keys.sorted()
    }

    private func prettify(_ key: String) -> String {
        key
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .capitalized
    }
}

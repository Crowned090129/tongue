import SwiftUI

/// AI Coach — a live chat backed by `/api/claude`. Proves the full stack
/// (auth → networking → dynamic JSON decode → UI) end-to-end.
struct CoachView: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.theme) private var theme

    @StateObject private var vm = CoachViewModel.make(coachService: PreviewStubs.coachService)
    @State private var didBind = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                messagesList
                inputBar
            }
            .background(theme.background)
            .navigationTitle("AI Coach")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if let remaining = vm.remaining {
                        Pill(text: "\(remaining) left today")
                    }
                }
            }
        }
        .onAppear {
            if !didBind {
                vm.rebind(coachService: env.coachService)
                vm.configure(
                    language: auth.profile?.language ?? .default,
                    nativeLang: "en"
                )
                didBind = true
            }
        }
        .sheet(isPresented: $vm.showPaywall) {
            PaywallView(reason: vm.paywallReason)
        }
        .tongueTheme()
    }

    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(vm.messages) { msg in
                        MessageBubble(message: msg)
                            .id(msg.id)
                    }
                    if vm.isSending {
                        MessageBubble(message: CoachMessage(role: .coach, text: "…"))
                            .opacity(0.6)
                    }
                    if let error = vm.errorMessage {
                        ErrorBanner(message: error)
                    }
                }
                .padding(Spacing.lg)
            }
            .onChange(of: vm.messages.count) { _ in
                if let last = vm.messages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    private var inputBar: some View {
        HStack(spacing: Spacing.sm) {
            // Voice input is scaffolded — see VoiceInputStub for the intended flow.
            Button {
                // Future: start speech recognition (Speech + AVFoundation).
            } label: {
                Image(systemName: "mic.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(theme.muted)
                    .frame(width: 44, height: 44)
                    .background(theme.surface2)
                    .clipShape(Circle())
            }
            .accessibilityLabel("Voice input (coming soon)")

            TextField("Message your coach…", text: $vm.draft, axis: .vertical)
                .font(TongueFont.body)
                .foregroundStyle(theme.text)
                .lineLimit(1...4)
                .padding(.horizontal, Spacing.md)
                .frame(minHeight: 44)
                .background(theme.surface2)
                .clipShape(RoundedRectangle(cornerRadius: Radius.button, style: .continuous))

            Button {
                Task { await vm.send() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(theme.brandGradient)
                    .clipShape(Circle())
                    .opacity(vm.canSend ? 1 : 0.4)
            }
            .disabled(!vm.canSend)
        }
        .padding(Spacing.md)
        .background(theme.surface)
        .overlay(theme.line.frame(height: 1), alignment: .top)
    }
}

/// A single chat bubble.
private struct MessageBubble: View {
    @Environment(\.theme) private var theme
    let message: CoachMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: Spacing.xxl) }
            Text(message.text)
                .font(TongueFont.callout)
                .foregroundStyle(message.role == .user ? .white : theme.text)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm + 2)
                .background(bubbleBackground)
                .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
            if message.role == .coach { Spacer(minLength: Spacing.xxl) }
        }
    }

    @ViewBuilder
    private var bubbleBackground: some View {
        if message.role == .user {
            theme.brandGradient
        } else {
            theme.surface
        }
    }
}

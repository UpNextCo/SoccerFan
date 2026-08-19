import SwiftUI
import UIKit

enum BKTheme {
    static let background = Color(hex: "0A0A0A")
    static let card = Color(hex: "1A1A1A")
    static let cardElevated = Color(hex: "242424")
    /// Backdrop behind game tile art — lifts icons whose PNGs use #141414.
    static let tileIconBackdrop = Color(hex: "181818")
    static let tileIconBrightness: CGFloat = 0.02
    static let tileIconScale: CGFloat = 1.1
    static let accent = Color(hex: "00FF66")
    static let accentMuted = Color(hex: "00CC52")
    static let textPrimary = Color.white
    static let textSecondary = Color(hex: "AAAAAA")
    static let textMuted = Color(hex: "666666")
    static let avatarPlaceholder = Color(hex: "888888")
    static let wrong = Color(hex: "FF4444")
    static let partial = Color(hex: "FFAA00")
    static let correct = Color(hex: "00FF66")
    static let streak = Color(hex: "FF6B00")
    static let inProgress = Color(hex: "FFB020")

    // Guess Who feedback badges (Who Are Ya style)
    static let guessCorrect = Color(hex: "00E055")
    static let guessWrong = Color(hex: "3D3D3D")
    static let guessPartial = Color(hex: "5C5C5C")
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: Double
        switch hex.count {
        case 6:
            r = Double((int >> 16) & 0xFF) / 255
            g = Double((int >> 8) & 0xFF) / 255
            b = Double(int & 0xFF) / 255
        default:
            r = 1; g = 1; b = 1
        }
        self.init(red: r, green: g, blue: b)
    }
}

struct BKFont {
    static func title(_ size: CGFloat = 28) -> Font {
        .system(size: size, weight: .heavy, design: .rounded)
    }

    static func headline(_ size: CGFloat = 17) -> Font {
        .system(size: size, weight: .bold, design: .rounded)
    }

    static func body(_ size: CGFloat = 15) -> Font {
        .system(size: size, weight: .medium, design: .default)
    }

    static func caption(_ size: CGFloat = 12) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
    }
}

private struct KeyboardHeightKey: EnvironmentKey {
    static let defaultValue: CGFloat = 0
}

extension EnvironmentValues {
    var keyboardHeight: CGFloat {
        get { self[KeyboardHeightKey.self] }
        set { self[KeyboardHeightKey.self] = newValue }
    }
}

enum KeyboardDismiss {
    static func resign() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

extension View {
    /// Shifts content above the software keyboard so focused fields stay visible.
    func liftsForKeyboard() -> some View {
        modifier(KeyboardLiftModifier())
    }

    /// A slight upward drag anywhere above the keyboard dismisses it.
    func dismissesKeyboardOnDragUp() -> some View {
        background(WindowKeyboardDismissInstaller())
    }
}

/// Lifts tab content and exposes the current keyboard height to the same view tree.
struct KeyboardLift<Content: View>: View {
    @ViewBuilder var content: (_ keyboardHeight: CGFloat) -> Content
    @State private var keyboardHeight: CGFloat = 0

    var body: some View {
        content(keyboardHeight)
            .padding(.bottom, keyboardHeight)
            .ignoresSafeArea(.keyboard)
            .environment(\.keyboardHeight, keyboardHeight)
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
                setHeight(from: notification, hiding: false)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { notification in
                setHeight(from: notification, hiding: true)
            }
    }

    private func setHeight(from notification: Notification, hiding: Bool) {
        KeyboardOverlap.apply(notification, hiding: hiding, to: $keyboardHeight)
    }
}

private struct KeyboardLiftModifier: ViewModifier {
    @State private var keyboardHeight: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .padding(.bottom, keyboardHeight)
            .ignoresSafeArea(.keyboard)
            .environment(\.keyboardHeight, keyboardHeight)
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
                KeyboardOverlap.apply(notification, hiding: false, to: $keyboardHeight)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { notification in
                KeyboardOverlap.apply(notification, hiding: true, to: $keyboardHeight)
            }
    }
}

private struct WindowKeyboardDismissInstaller: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        DispatchQueue.main.async {
            context.coordinator.attach(to: uiView.window)
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        private weak var window: UIWindow?
        private var pan: UIPanGestureRecognizer?

        private var observers: [NSObjectProtocol] = []

        func attach(to window: UIWindow?) {
            guard let window else { return }
            if window === self.window, pan != nil { return }
            detach()
            self.window = window
            let pan = UIPanGestureRecognizer(target: self, action: #selector(handle))
            pan.cancelsTouchesInView = false
            pan.delaysTouchesBegan = false
            pan.delaysTouchesEnded = false
            pan.delegate = self
            window.addGestureRecognizer(pan)
            self.pan = pan
            observeKeyboard()
        }

        func detach() {
            if let pan, let window {
                window.removeGestureRecognizer(pan)
            }
            pan = nil
            window = nil
            observers.forEach { NotificationCenter.default.removeObserver($0) }
            observers.removeAll()
        }

        private func observeKeyboard() {
            guard observers.isEmpty else { return }
            let center = NotificationCenter.default
            observers.append(center.addObserver(
                forName: UIResponder.keyboardWillChangeFrameNotification,
                object: nil,
                queue: .main
            ) { notification in
                KeyboardOverlap.currentHeight = KeyboardOverlap.height(from: notification, hiding: false)
            })
            observers.append(center.addObserver(
                forName: UIResponder.keyboardWillHideNotification,
                object: nil,
                queue: .main
            ) { notification in
                KeyboardOverlap.currentHeight = KeyboardOverlap.height(from: notification, hiding: true)
            })
        }

        @objc private func handle(_ gesture: UIPanGestureRecognizer) {
            guard KeyboardOverlap.currentHeight > 8 else { return }
            let translation = gesture.translation(in: gesture.view)
            let velocity = gesture.velocity(in: gesture.view)
            let draggedUp = translation.y < -18 || (translation.y < -8 && velocity.y < -380)
            let mostlyVertical = abs(translation.x) < abs(translation.y) + 12
            guard draggedUp, mostlyVertical else { return }
            KeyboardDismiss.resign()
            gesture.isEnabled = false
            gesture.isEnabled = true
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }
    }
}

private enum KeyboardOverlap {
    static var currentHeight: CGFloat = 0
    static func height(from notification: Notification, hiding: Bool) -> CGFloat {
        if hiding { return 0 }
        guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
            return 0
        }
        return overlap(with: frame)
    }

    static func apply(_ notification: Notification, hiding: Bool, to height: Binding<CGFloat>) {
        let duration = (notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let next = Self.height(from: notification, hiding: hiding)
        withAnimation(.easeOut(duration: duration)) {
            height.wrappedValue = next
        }
        currentHeight = next
    }

    static func overlap(with keyboardFrame: CGRect) -> CGFloat {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
        let bounds = window?.bounds ?? UIScreen.main.bounds
        let converted = window?.convert(keyboardFrame, from: nil) ?? keyboardFrame
        let covered = converted.intersection(bounds).height
        // Content is already above the home indicator; counting it again leaves a black gap.
        let safeBottom = window?.safeAreaInsets.bottom ?? 0
        return max(0, covered - safeBottom)
    }
}

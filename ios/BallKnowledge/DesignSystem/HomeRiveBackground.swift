import SwiftUI
import RiveRuntime

/// Full-screen Rive animation for the home scroll background.
/// Expects `Resources/Rive/home_ambient.riv` in the app bundle.
struct HomeRiveBackground: View {
    @StateObject private var viewModel: RiveViewModel

    init() {
        _viewModel = StateObject(wrappedValue: Self.makeViewModel())
    }

    var body: some View {
        ZStack {
            BKTheme.background
            viewModel.view()
        }
        .overlay { HomeBackgroundFade() }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    private static func makeViewModel() -> RiveViewModel {
        if let url = HomeRiveConfig.bundleURL,
           let data = try? Data(contentsOf: url),
           let file = try? RiveFile(data: data, loadCdn: false) {
            return RiveViewModel(
                RiveModel(riveFile: file),
                fit: .cover,
                alignment: .center,
                autoPlay: true
            )
        }

        return RiveViewModel(
            fileName: HomeRiveConfig.fileName,
            fit: .cover,
            alignment: .center,
            autoPlay: true,
            loadCdn: false
        )
    }
}

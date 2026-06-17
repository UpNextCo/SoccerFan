import SwiftUI
import UIKit

enum GameModeTileArt {
    /// Drop `{modeId}.png` into `Resources/GameTiles/` — no Asset Catalog needed.
    static func bundleImageName(for modeId: String) -> String? {
        bundleImageURL(for: modeId) != nil ? modeId : nil
    }

    static func bundleImageURL(for name: String) -> URL? {
        if let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "GameTiles") {
            return url
        }
        if let url = Bundle.main.url(forResource: name, withExtension: "png") {
            return url
        }
        if let path = Bundle.main.path(forResource: name, ofType: "png", inDirectory: "GameTiles") {
            return URL(fileURLWithPath: path)
        }
        return nil
    }
}

struct GameModeBundleImage: View {
    let name: String

    var body: some View {
        if let image = loadImage() {
            Image(uiImage: image)
                .resizable()
        }
    }

    private func loadImage() -> UIImage? {
        guard let url = GameModeTileArt.bundleImageURL(for: name),
              let image = UIImage(contentsOfFile: url.path) else {
            return nil
        }
        return image
    }
}

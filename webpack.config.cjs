// File: webpack.config.cjs
// Electron의 렌더러 프로세스를 위한 Webpack 설정 파일
const path = require('path');

module.exports = {
  mode: 'development', // 개발 모드 ('production'으로 변경 시 최적화됨)
  target: 'electron-renderer', // Electron의 렌더러 프로세스를 타겟으로 설정

  entry: './src/index.js', // 번들링 시작점
  output: {
    path: path.resolve(__dirname, 'dist'), // 번들 파일 출력 위치
    filename: 'renderer.bundle.js', // 번들 파일 이름
  },

  resolve: {
    extensions: ['.js', '.jsx', '.css'], // 생략 가능한 확장자들
    alias: {
      '@': path.resolve(__dirname, 'src'),          // @ -> src/
      '@assets': path.resolve(__dirname, 'src/assets') // @assets -> src/assets/
    },
    // fallback 설정은 필요 시 Node 내장 모듈 대체용
    // fallback: {
    //   fs: false,
    //   path: false
    // }
  },

  // 외부 모듈 처리: 번들링하지 않고 require로 남김
  externals: {
    fs: 'commonjs fs',
    path: 'commonjs path',
    electron: 'commonjs electron',
    '@electron/remote': 'commonjs @electron/remote',
    'electron-store': 'commonjs electron-store',
  },

  devtool: 'source-map', // 디버깅을 위한 소스맵 활성화

  module: {
    rules: [
      {
        test: /\.jsx?$/, // .js 또는 .jsx 파일
        exclude: /node_modules/,
        use: 'babel-loader', // 최신 JS → 구버전 JS로 변환
        resolve: {
          fullySpecified: false
        },
      },
      {
        test: /\.css$/, // CSS 파일 처리
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/i, // 이미지 파일들
        type: 'asset/resource',
        generator: {
          filename: 'assets/[name][ext]' // 이미지는 assets 폴더로 복사됨
        }
      }
    ]
  }
};

// // webpack.config.js

// const path = require('path');

// module.exports = {
//   mode: 'development', // 배포 시 'production'으로 변경
//   target: 'electron-renderer',  // Electron 렌더러용 번들임을 명시

//   entry: './src/index.js', // React 진입점 파일
//   output: {
//     path: path.resolve(__dirname, 'dist'),
//     filename: 'renderer.bundle.js'
//   },
//   resolve: {
//     extensions: ['.js', '.jsx'], // .jsx 파일도 인식
//     alias: {
//       // '@'를 'src' 디렉토리로 매핑
//       '@': path.resolve(__dirname, 'src'),
//     },
    
//     fallback: {
//       fs: false,
//       path: false
//     }
//   },

//   // Node/Electron 모듈들을 번들에서 제외
//   externals: {
//     fs: 'commonjs fs',
//     path: 'commonjs path',
//     electron: 'commonjs electron',
//     '@electron/remote': 'commonjs @electron/remote'
//   },  

//   devtool: 'source-map',
//   module: {
//     rules: [
//       {
//         test: /\.jsx?$/,
//         exclude: /node_modules/,
//         use: {
//           loader: 'babel-loader'
//         }
//       },
//       {
//         test: /\.css$/, // CSS 파일 처리 규칙 추가\n 
//         use: ['style-loader', 'css-loader']
//       }
//     ]
//   }
// };

// File: webpack.config.js
const path = require('path');

module.exports = {
  mode: 'development', // 배포 시 'production'으로 변경
  target: 'electron-renderer',  // Electron 렌더러용 번들 명시

  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'renderer.bundle.js'
  },
  resolve: {
    extensions: ['.js', '.jsx', '.css'], // CSS 확장자 추가
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@assets': path.resolve(__dirname, 'src/assets')
    },
    fallback: {
      fs: false,
      path: false
    }
  },

  externals: {
    fs: 'commonjs fs',
    path: 'commonjs path',
    electron: 'commonjs electron',
    '@electron/remote': 'commonjs @electron/remote'
  },

  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: 'babel-loader'
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/[name][ext]' // 빌드된 이미지들을 assets/에 복사
        }
      }
    ]
  }
};
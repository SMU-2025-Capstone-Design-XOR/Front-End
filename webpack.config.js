// webpack.config.js

const path = require('path');

module.exports = {
  mode: 'development', // 배포 시 'production'으로 변경
  entry: './src/index.js', // React 진입점 파일
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'renderer.bundle.js'
  },
  resolve: {
    extensions: ['.js', '.jsx'], // .jsx 파일도 인식
    alias: {
      // '@'를 'src' 디렉토리로 매핑
      '@': path.resolve(__dirname, 'src'),
    }    
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader'
        }
      },
      {
        test: /\.css$/, // CSS 파일 처리 규칙 추가\n 
        use: ['style-loader', 'css-loader']
      }
    ]
  }
};

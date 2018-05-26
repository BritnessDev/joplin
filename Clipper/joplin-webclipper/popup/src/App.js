import React, { Component } from 'react';
import './App.css';
import led_red from './led_red.png'; // Tell Webpack this JS file uses this image
import led_green from './led_green.png'; // Tell Webpack this JS file uses this image
import led_orange from './led_orange.png'; // Tell Webpack this JS file uses this image

const { connect } = require('react-redux');
const { bridge } = require('./bridge');

class AppComponent extends Component {

	constructor() {
		super();

		this.state = ({
			contentScriptLoaded: false,
		});

		this.confirm_click = () => {
			bridge().sendContentToJoplin(this.props.clippedContent);
		}

		this.contentTitle_change = (event) => {
			this.props.dispatch({
				type: 'CLIPPED_CONTENT_TITLE_SET',
				text: event.currentTarget.value
			});		
		}

		this.clipScreenshot_click = async () => {
			try {
				const baseUrl = await bridge().clipperServerBaseUrl();

				bridge().sendCommandToActiveTab({
					name: 'screenshot',
					apiBaseUrl: baseUrl,
				});

				window.close();
			} catch (error) {
				this.props.dispatch({ type: 'CONTENT_UPLOAD', operation: { uploading: false, success: false, errorMessage: error.message } });
			}
		}

		this.clipperServerHelpLink_click = () => {
			bridge().tabsCreate({ url: 'https://joplin.cozic.net/clipper' });
		}
	}

	clipSimplified_click() {
		bridge().sendCommandToActiveTab({
			name: 'simplifiedPageHtml',
		});
	}

	clipComplete_click() {
		bridge().sendCommandToActiveTab({
			name: 'completePageHtml',
		});
	}

	async loadContentScripts() {
		await bridge().tabsExecuteScript({file: "/content_scripts/JSDOMParser.js"});
		await bridge().tabsExecuteScript({file: "/content_scripts/Readability.js"});
		await bridge().tabsExecuteScript({file: "/content_scripts/index.js"});
	}

	async componentDidMount() {
		await this.loadContentScripts();
		this.setState({
			contentScriptLoaded: true,
		});
	}

	render() {
		if (!this.state.contentScriptLoaded) return 'Loading...';

		const warningComponent = !this.props.warning ? null : <div className="Warning">{ this.props.warning }</div>

		const hasContent = !!this.props.clippedContent;
		const content = this.props.clippedContent;

		let previewComponent = null;

		const operation = this.props.contentUploadOperation;

		if (operation) {
			let msg = '';

			if (operation.searchingClipperServer) {
				msg = 'Searching clipper service... Please make sure that Joplin is running.';
			} else if (operation.uploading) {
				msg = 'Processing note... The note will be available in Joplin as soon as the web page and images have been downloaded and converted. In the meantime you may close this popup.';
			} else if (operation.success) {
				msg = 'Note was successfully created!';
			} else {
				msg = 'There was some error creating the note: ' + operation.errorMessage;
			}

			previewComponent = (
				<div className="Preview">
					<p className="Info">{ msg }</p>
				</div>
			);
		} else {
			if (hasContent) {
				previewComponent = (
					<div className="Preview">
						<input className={"Title"} value={content.title} onChange={this.contentTitle_change}/>
						<div className={"BodyWrapper"}>
							<div className={"Body"} dangerouslySetInnerHTML={{__html: content.bodyHtml}}></div>
						</div>
						<a className={"Confirm Button"} onClick={this.confirm_click}>Confirm</a>
					</div>
				);
			} else {
				previewComponent = (
					<div className="Preview">
						<p className="Info">(No preview yet)</p>
					</div>
				);
			}
		}

		const clipperStatusComp = () => {

			const stateToString = function(state) {
				if (state === 'not_found') return 'Not found';
				return state.charAt(0).toUpperCase() + state.slice(1);
			} 

			let msg = ''
			let led = null;
			let helpLink = null;

			const foundState = this.props.clipperServer.foundState
			
			if (foundState === 'found') {
				msg = "Ready on port " + this.props.clipperServer.port
				led = led_green
			} else {
				msg = stateToString(foundState)
				led = foundState === 'searching' ? led_orange : led_red
				if (foundState === 'not_found') helpLink = <a className="Help" onClick={this.clipperServerHelpLink_click} href="#">[Help]</a>
			}

			msg = "Service status: " + msg

			return <div className="StatusBar"><img className="Led" src={led}/><span className="ServerStatus">{ msg }{ helpLink }</span></div>
		}		

		return (
			<div className="App">
				<div className="Controls">			
					<ul>
						<li><a className="Button" onClick={this.clipSimplified_click}>Clip simplified page</a></li>
						<li><a className="Button" onClick={this.clipComplete_click}>Clip complete page</a></li>
						<li><a className="Button" onClick={this.clipScreenshot_click}>Clip screenshot</a></li>
					</ul>
				</div>
				{ warningComponent }
				<h2>Preview:</h2>
				{ previewComponent }
				{ clipperStatusComp() }
			</div>
		);
	}

}

const mapStateToProps = (state) => {
	return {
		warning: state.warning,
		clippedContent: state.clippedContent,
		contentUploadOperation: state.contentUploadOperation,
		clipperServer: state.clipperServer,
	};
};

const App = connect(mapStateToProps)(AppComponent);

export default App;

import logging

from server.log_config import configure_hme_file_logger


def test_configure_hme_file_logger_dedupes_same_file(tmp_path):
    logger = logging.getLogger("HME.test.dedupe")
    logger.handlers.clear()
    logger.setLevel(logging.INFO)
    logger.propagate = True
    log_file = tmp_path / "hme.log"

    h1 = configure_hme_file_logger(logger, str(log_file))
    h2 = configure_hme_file_logger(logger, str(log_file))

    assert h1 is h2
    assert logger.propagate is False
    assert len([h for h in logger.handlers if getattr(h, "baseFilename", "") == str(log_file)]) == 1
    logger.info("one")
    h1.flush()
    assert log_file.read_text().count("one") == 1
